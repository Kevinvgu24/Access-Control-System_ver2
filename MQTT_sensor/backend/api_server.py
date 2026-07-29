import os
import sys
import sqlite3
import json
import time
from datetime import datetime
from flask import Flask, request, jsonify, Response
from flask_cors import CORS

current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.append(current_dir)

from database import SensorDatabase
from logger import get_logger
from mqtt_service import MQTTTelemetryService

logger = get_logger("api_server_sensors")

app = Flask(__name__)
CORS(app)  # Enable CORS for frontend development

# Paths resolution
project_root = os.path.abspath(os.path.join(current_dir, "..", ".."))
db_dir = os.path.join(project_root, "database")
os.makedirs(db_dir, exist_ok=True)
db_path = os.path.join(db_dir, "smart_door.db")

# Initialize database & MQTT Telemetry Service
db = SensorDatabase(db_path)
mqtt_service = MQTTTelemetryService(db)
mqtt_service.start()

# ... [SECURITY & PRIVACY REDACTED: Face Recognition Model Loading, Qdrant Vector Indexing, & User Enrollment Handlers] ...

@app.route("/api/health", methods=["GET"])
def health_check():
    return jsonify({
        "status": "healthy",
        "service": "MQTT Sensor Telemetry Subsystem",
        "timestamp": datetime.now().astimezone().isoformat()
    })

# =========================================================================
# SENSOR TELEMETRY & SUBNODE PAIRING API ENDPOINTS
# =========================================================================

# 1. Real-time Telemetry & Unapproved Subnodes Pending Queue Endpoint
@app.route("/api/labs/<lab_id>/sensors", methods=["GET"])
def get_latest_sensors(lab_id):
    from mqtt_service import get_lab_state, labs_registry
    state = get_lab_state(lab_id)
    subnodes_registry = state["subnodes"]
    latest_sensor_data = state["latest_sensor_data"]

    now_dt = datetime.now().astimezone()

    # 1. Filter subnodes belonging to this lab_id
    subnodes_list = []
    any_online = False

    for node_id, node_info in list(subnodes_registry.items()):
        node_copy = node_info.copy()
        if node_copy.get("maintenance_mode", False):
            node_copy["online"] = False
            node_copy["sensor_ok"] = False
            node_copy["error_msg"] = "Disconnected for Maintenance"
        elif node_copy.get("last_updated"):
            try:
                last_dt = datetime.fromisoformat(node_copy["last_updated"])
                if last_dt.tzinfo is None:
                    last_dt = last_dt.astimezone()
                if (now_dt - last_dt).total_seconds() > 15.0:
                    node_copy["online"] = False
                    node_copy["sensor_ok"] = False
                    node_copy["error_msg"] = "Connection Timeout (>15s)"
            except Exception:
                node_copy["online"] = False
        else:
            node_copy["online"] = False
            node_copy["sensor_ok"] = False
            node_copy["error_msg"] = "Never Connected"

        if node_copy["online"]:
            any_online = True

        subnodes_list.append(node_copy)

    # 2. Active Pending Nodes filter (Aggregate from all labs, purge if inactive > 15 seconds)
    active_pending = []
    seen_pending_ids = set()
    now_ts = time.time()
    for lid, lstate in list(labs_registry.items()):
        pending_queue = lstate.get("pending_subnodes", {})
        for pid, pnode in list(pending_queue.items()):
            last_seen = pnode.get("last_seen_ts", 0)
            if last_seen > 0 and (now_ts - last_seen) <= 15.0:
                if pid not in seen_pending_ids:
                    seen_pending_ids.add(pid)
                    active_pending.append(pnode)
            else:
                pending_queue.pop(pid, None)

    # 3. Room Telemetry Overview summary
    summary = latest_sensor_data.copy()
    summary["subnodes"] = subnodes_list
    summary["online"] = any_online

    return jsonify({
        "labId": lab_id,
        "summary": summary,
        "subnodes": subnodes_list,
        "pending_nodes": active_pending
    })

# 2. Approve & Pair Subnode Endpoint (Strict Cross-Lab Duplicate Protection)
@app.route("/api/labs/<path:lab_id>/subnodes/approve", methods=["POST"])
def approve_subnode(lab_id):
    from mqtt_service import get_lab_state, labs_registry
    state = get_lab_state(lab_id)
    subnodes_registry = state["subnodes"]
    
    req_data = request.json or {}
    node_id = str(req_data.get("node_id", "")).strip()

    if not node_id:
        return jsonify({"success": False, "message": "Missing node_id"}), 400

    # 1. STRICT CROSS-LAB DUPLICATE SUBNODE CHECK: Ensure node_id is not already paired to another lab
    existing_db_node = db.get_subnode_globally(node_id)
    if existing_db_node and existing_db_node.get("labId"):
        existing_lab = existing_db_node["labId"]
        if existing_lab.lower().strip() != lab_id.lower().strip():
            return jsonify({
                "success": False, 
                "message": f"Subnode '{node_id}' is ALREADY paired to Lab '{existing_lab}'! A hardware subnode cannot belong to multiple labs."
            }), 400

    # Check memory registry across all labs for duplicate node_id
    for lid, lstate in list(labs_registry.items()):
        if lid.lower().strip() != lab_id.lower().strip():
            if node_id in lstate.get("subnodes", {}):
                return jsonify({
                    "success": False, 
                    "message": f"Subnode '{node_id}' is ALREADY paired to Lab '{lid}' in active memory!"
                }), 400

    # Pop node from pending queue
    pending_node = None
    for lid, lstate in list(labs_registry.items()):
        p_queue = lstate.get("pending_subnodes", {})
        for pid in list(p_queue.keys()):
            if pid.lower().strip() == node_id.lower().strip():
                pending_node = p_queue.pop(pid)
                break
        if pending_node:
            break

    if not pending_node and node_id not in subnodes_registry:
        return jsonify({"success": False, "message": "Node not found in pending queue"}), 404

    custom_name = (req_data.get("custom_name") or "").strip()
    if custom_name:
        name = custom_name
    elif pending_node and pending_node.get("name") and not pending_node["name"].startswith("Discovered ESP32"):
        name = pending_node["name"]
    else:
        existing_count = len(subnodes_registry) + 1
        name = f"Subnode {existing_count} ({node_id})"

    # 2. STRICT CROSS-LAB NAME DUPLICATION CHECK across all labs in SQLite DB & memory
    existing_names = set()
    all_db_subnodes = db.get_all_subnodes_globally()
    for row in all_db_subnodes:
        if row["id"].lower().strip() != node_id.lower().strip() and row.get("name"):
            existing_names.add(row["name"].lower().strip())

    for lid, lstate in list(labs_registry.items()):
        for sid, snode in lstate.get("subnodes", {}).items():
            if sid.lower().strip() != node_id.lower().strip() and snode.get("name"):
                existing_names.add(snode["name"].lower().strip())

    if name.lower().strip() in existing_names:
        if pending_node:
            state["pending_subnodes"][node_id] = pending_node
        return jsonify({"success": False, "message": f"Subnode name '{name}' is already used by another node in the system! Please choose a unique name."}), 400

    sensors = pending_node.get("sensors", "Dynamic MQTT Sensors") if pending_node else "Approved Dynamic Cluster"

    # Purge node from any other lab's subnodes registry in memory if re-assigned
    for lid, lstate in list(labs_registry.items()):
        if lid.lower().strip() != lab_id.lower().strip():
            lstate.get("subnodes", {}).pop(node_id, None)

    subnodes_registry[node_id] = {
        "id": node_id,
        "name": name,
        "sensors": sensors,
        "online": True,
        "sensor_ok": True,
        "maintenance_mode": False,
        "error_msg": None,
        "last_updated": datetime.now().astimezone().isoformat(),
        "last_updated_ts": time.time(),
        "connected_at_ts": time.time(),
        "capabilities": [],
        "data": pending_node.get("sample_data", {}) if pending_node else {}
    }
    
    # Save to SQLite database so it persists across restarts
    db.save_subnode(lab_id, node_id, name, sensors)
    from mqtt_service import rejected_subnodes
    rejected_subnodes.discard(node_id)

    logger.info(f"Approved and paired new ESP32 Subnode '{node_id}' ({name}).")
    return jsonify({"success": True, "message": f"Subnode '{name}' paired successfully", "subnode": subnodes_registry[node_id]})

# 3. Reject Subnode Endpoint (Adds to Blacklist)
@app.route("/api/labs/<path:lab_id>/subnodes/reject", methods=["POST"])
def reject_subnode(lab_id):
    from mqtt_service import labs_registry, rejected_subnodes
    
    req_data = request.json or {}
    node_id = req_data.get("node_id")

    if not node_id:
        return jsonify({"success": False, "message": "Missing node_id"}), 400

    rejected_subnodes.add(node_id)
    for lid, lstate in list(labs_registry.items()):
        lstate["pending_subnodes"].pop(node_id, None)

    logger.info(f"Rejected pending ESP32 Subnode pairing request '{node_id}'. Added to blacklist.")
    return jsonify({"success": True, "message": "Pending subnode pairing rejected"})

# 4. Toggle Maintenance Mode Endpoint
@app.route("/api/labs/<path:lab_id>/subnodes/<node_id>/toggle-maintenance", methods=["POST"])
def toggle_maintenance(lab_id, node_id):
    from mqtt_service import get_lab_state, labs_registry
    state = get_lab_state(lab_id)
    
    node = state["subnodes"].get(node_id)
    if not node:
        for lid, lstate in list(labs_registry.items()):
            if node_id in lstate["subnodes"]:
                node = lstate["subnodes"][node_id]
                break

    if not node:
        return jsonify({"success": False, "message": "Node not found"}), 404

    current_mode = bool(node.get("maintenance_mode", False))
    new_mode = not current_mode
    node["maintenance_mode"] = new_mode

    db.update_subnode_maintenance(lab_id, node_id, new_mode)

    if new_mode:
        node["online"] = False
        node["sensor_ok"] = False
        node["error_msg"] = "Disconnected for Maintenance"
    else:
        node["online"] = True
        node["sensor_ok"] = True
        node["error_msg"] = None
        node["last_updated"] = datetime.now().astimezone().isoformat()
        node["last_updated_ts"] = time.time()

    mode_label = "ENABLED" if new_mode else "DISABLED"
    logger.info(f"Maintenance mode {mode_label} for ESP32 Subnode '{node_id}'.")
    return jsonify({"success": True, "maintenance_mode": new_mode, "message": f"Maintenance mode {mode_label}"})

# 5. Delete Subnode Endpoint
@app.route("/api/labs/<path:lab_id>/subnodes/<node_id>", methods=["DELETE"])
def delete_subnode(lab_id, node_id):
    from mqtt_service import get_lab_state, labs_registry
    state = get_lab_state(lab_id)
    
    removed_registry = state["subnodes"].pop(node_id, None)
    removed_pending = state["pending_subnodes"].pop(node_id, None)

    # Search in all labs as fallback
    if not removed_registry and not removed_pending:
        for lid, lstate in list(labs_registry.items()):
            r = lstate["subnodes"].pop(node_id, None)
            p = lstate["pending_subnodes"].pop(node_id, None)
            if r or p:
                removed_registry = r
                removed_pending = p
                break

    db.delete_subnode(lab_id, node_id)

    if removed_registry or removed_pending:
        logger.info(f"Deleted ESP32 Subnode '{node_id}' completely.")
        return jsonify({"success": True, "message": f"Deleted subnode '{node_id}'"})
    else:
        return jsonify({"success": False, "message": "Node not found"}), 404

# 6. Manual HTTP Telemetry Ingress Endpoint
@app.route("/api/labs/<lab_id>/sensors/telemetry", methods=["POST"])
def post_sensor_telemetry(lab_id):
    data = request.get_json() or {}
    mqtt_service.process_telemetry_payload(f"smartdoor/{lab_id}/sensors/http", data)
    return jsonify({"success": True, "message": "Sensor telemetry received"})

# 7. Combined Sensor Telemetry History CSV Export
@app.route("/api/labs/<lab_id>/sensors/export", methods=["GET"])
def export_sensor_history(lab_id):
    conn = sqlite3.connect(db_path)
    c = conn.cursor()
    c.execute("SELECT id, receivedAt, temperature, humidity, latitude, longitude, altitude, speed, satellites, dht_ok, gnss_ok FROM environment_telemetry WHERE LOWER(labId) = LOWER(?) OR labId = 'default-lab' ORDER BY id DESC LIMIT 10000", (lab_id,))
    rows = c.fetchall()
    if not rows:
        c.execute("SELECT id, receivedAt, temperature, humidity, latitude, longitude, altitude, speed, satellites, dht_ok, gnss_ok FROM environment_telemetry ORDER BY id DESC LIMIT 10000")
        rows = c.fetchall()
    conn.close()

    import csv
    from io import StringIO
    si = StringIO()
    cw = csv.writer(si)
    cw.writerow(["ID", "Time", "Temperature (C)", "Humidity (%)", "Latitude", "Longitude", "Altitude (m)", "Speed (km/h)", "Satellites", "DHT OK", "GNSS OK"])
    cw.writerows(rows)
    
    response = Response(si.getvalue(), mimetype="text/csv")
    response.headers["Content-Disposition"] = f"attachment; filename=Sensor_Telemetry_Export.csv"
    return response

# 8. Individual Node Telemetry History CSV Export
@app.route("/api/labs/<lab_id>/nodes/<node_id>/telemetry/export", methods=["GET"])
def export_individual_node_history(lab_id, node_id):
    conn = sqlite3.connect(db_path)
    c = conn.cursor()
    c.execute("SELECT id, receivedAt, temperature, humidity, pm25, co2, light, latitude, longitude, altitude, speed, satellites, sensor_ok FROM node_telemetry_history WHERE (LOWER(node_id) = LOWER(?) OR LOWER(node_id) LIKE LOWER(?)) AND (LOWER(labId) = LOWER(?) OR labId = 'default-lab') ORDER BY id DESC LIMIT 10000", (node_id, f"%{node_id}%", lab_id))
    rows = c.fetchall()
    if not rows:
        c.execute("SELECT id, receivedAt, temperature, humidity, pm25, co2, light, latitude, longitude, altitude, speed, satellites, sensor_ok FROM node_telemetry_history WHERE LOWER(node_id) = LOWER(?) OR LOWER(node_id) LIKE LOWER(?) ORDER BY id DESC LIMIT 10000", (node_id, f"%{node_id}%"))
        rows = c.fetchall()
    conn.close()

    import csv
    from io import StringIO
    si = StringIO()
    cw = csv.writer(si)
    cw.writerow(["Record ID", "Time", "Temperature (C)", "Humidity (%)", "PM2.5", "CO2 (ppm)", "Light (Lux)", "Latitude", "Longitude", "Altitude (m)", "Speed (km/h)", "Satellites", "Sensor OK"])
    cw.writerows(rows)
    
    response = Response(si.getvalue(), mimetype="text/csv")
    response.headers["Content-Disposition"] = f"attachment; filename=Node_{node_id}_Telemetry.csv"
    return response

# ... [SECURITY & PRIVACY REDACTED: Biometric Face Recognition, Door Unlock Control, PIN Fallback, User Enrollment, & Schedule Endpoints] ...

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
