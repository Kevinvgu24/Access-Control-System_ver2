import os
import sys
import sqlite3
import json
import hashlib
import numpy as np
import time
import threading
from datetime import datetime
from flask import Flask, request, jsonify, send_from_directory, Response
from flask_cors import CORS

# Add parent directory to path to allow importing database module
current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.append(current_dir)

from database import FaceDatabase
from logger import get_logger

logger = get_logger("api_server")

app = Flask(__name__)
CORS(app)  # Enable CORS for frontend development

# Paths resolution
project_root = os.path.abspath(os.path.join(current_dir, "..", ".."))
db_dir = os.path.join(project_root, "database")
os.makedirs(db_dir, exist_ok=True)
db_path = os.path.join(db_dir, "smart_door.db")

# Initialize database
db = FaceDatabase(db_path)

# Initialize Qdrant Client
qdrant_client = None
QDRANT_COLLECTION = "faces"

def init_qdrant():
    global qdrant_client
    qdrant_host = os.environ.get("QDRANT_HOST", "qdrant")
    qdrant_port = int(os.environ.get("QDRANT_PORT", 6333))
    try:
        from qdrant_client import QdrantClient
        from qdrant_client.models import Distance, VectorParams
        logger.info(f"Connecting to Qdrant at {qdrant_host}:{qdrant_port}...")
        client = QdrantClient(host=qdrant_host, port=qdrant_port, timeout=10.0)
        
        # Check if collection exists
        collections_res = client.get_collections()
        existing = [c.name for c in collections_res.collections]
        if QDRANT_COLLECTION not in existing:
            logger.info(f"Creating Qdrant collection '{QDRANT_COLLECTION}'...")
            client.create_collection(
                collection_name=QDRANT_COLLECTION,
                vectors_config=VectorParams(size=512, distance=Distance.COSINE),
            )
        qdrant_client = client
        logger.info("Successfully connected to Qdrant and verified 'faces' collection.")
        backfill_existing_embeddings()
    except Exception as e:
        logger.warning(f"Could not initialize Qdrant (using SQLite fallback): {e}")
        qdrant_client = None

def backfill_existing_embeddings():
    if qdrant_client is None:
        return
    try:
        conn = sqlite3.connect(db_path, detect_types=sqlite3.PARSE_DECLTYPES)
        c = conn.cursor()
        c.execute("SELECT id, name, embedding FROM users WHERE embedding IS NOT NULL")
        rows = c.fetchall()
        conn.close()
        
        if not rows:
            logger.info("No existing embeddings in SQLite to backfill.")
            return
            
        logger.info(f"Syncing {len(rows)} existing user embeddings from SQLite to Qdrant...")
        from qdrant_client.models import PointStruct
        
        points = []
        for row in rows:
            user_id, name, emb = row
            if isinstance(emb, np.ndarray):
                points.append(
                    PointStruct(
                        id=user_id,
                        vector=emb.tolist(),
                        payload={"name": name}
                    )
                )
                
        if points:
            qdrant_client.upsert(
                collection_name=QDRANT_COLLECTION,
                points=points
            )
            logger.info("Successfully synced all existing embeddings to Qdrant.")
    except Exception as e:
        logger.error(f"Error backfilling embeddings to Qdrant: {e}")

# Run initialization in background thread to prevent blocking web server startup
def qdrant_init_thread():
    for i in range(10):
        init_qdrant()
        if qdrant_client is not None:
            break
        time.sleep(3)

threading.Thread(target=qdrant_init_thread, daemon=True).start()

# Global dictionary to track on-demand IR livestream sessions: { node_id: timestamp_last_requested }
active_ir_streams = {}
# Global dictionary to store the latest raw JPEG bytes for each node: { node_id: bytes }
latest_frames = {}

# Serve built static React Web App
static_dir = os.path.join(project_root, "web_app", "dist")

@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_web_app(path):
    if not os.path.exists(static_dir):
        return jsonify({
            "error": "React production build directory not found. Please run 'npm run build' inside the web_app directory first."
        }), 500
        
    if path != "" and os.path.exists(os.path.join(static_dir, path)):
        return send_from_directory(static_dir, path)
    else:
        # SPA routing fallback: always serve index.html for unknown frontend routes
        return send_from_directory(static_dir, "index.html")

# ── API ENDPOINTS ─────────────────────────────────────────────────────────────

# 1. Auth Endpoint
@app.route("/api/auth/login", methods=["POST"])
def api_login():
    data = request.get_json() or {}
    email = data.get("email")
    password = data.get("password")
    
    if not email or not password:
        return jsonify({"error": "Email and Password are required"}), 400
        
    pw_hash = hashlib.sha256(password.encode()).hexdigest()
    
    conn = sqlite3.connect(db_path)
    c = conn.cursor()
    c.execute("SELECT id, displayName, type, status FROM admins WHERE email = ? AND password = ?", (email, pw_hash))
    row = c.fetchone()
    conn.close()
    
    if not row:
        # Fallback for initial login before first admin entry or master credential
        if email == "dawnnkevin9@gmail.com" and password == "admin123":
            return jsonify({
                "firebaseUid": "default-admin",
                "userId": "default-admin",
                "email": email,
                "displayName": "Kevin",
                "type": "super_admin",
                "role": "super_admin",
                "status": "active"
            })
        return jsonify({"error": "Invalid email or password"}), 401
        
    admin_id, display_name, admin_type, status = row
    if status != "active":
        return jsonify({"error": "Account is suspended"}), 403
        
    return jsonify({
        "firebaseUid": admin_id,
        "userId": admin_id,
        "email": email,
        "displayName": display_name,
        "type": admin_type,
        "role": admin_type,
        "status": status
    })

# 2. Labs List
@app.route("/api/labs", methods=["GET"])
def get_labs():
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute("SELECT * FROM labs")
    rows = c.fetchall()
    conn.close()
    
    labs_list = [dict(row) for row in rows]
    return jsonify(labs_list)

# 3. Lab Clusters List
@app.route("/api/labs/<lab_id>/clusters", methods=["GET"])
def get_clusters(lab_id):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute("SELECT * FROM clusters WHERE labId = ?", (lab_id,))
    rows = c.fetchall()
    conn.close()
    
    clusters_list = [dict(row) for row in rows]
    return jsonify(clusters_list)

# 4. Cluster Nodes List
@app.route("/api/labs/<lab_id>/clusters/<cluster_id>/nodes", methods=["GET"])
def get_nodes(lab_id, cluster_id):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute("SELECT * FROM nodes WHERE labId = ? AND clusterId = ?", (lab_id, cluster_id))
    rows = c.fetchall()
    conn.close()
    
    nodes_list = []
    for row in rows:
        node_dict = dict(row)
        
        # Check heartbeat age (older than 5s means the board/sync client is offline)
        is_offline = True
        updated_at_str = node_dict.get("updatedAt")
        if updated_at_str:
            try:
                last_update = datetime.fromisoformat(updated_at_str)
                age_seconds = (datetime.now() - last_update).total_seconds()
                if age_seconds < 5.0:
                    is_offline = False
            except Exception:
                pass
                
        if is_offline:
            node_dict["onlineState"] = "offline"
            node_dict["status"] = "offline"
            
        if node_dict.get("latestTelemetry"):
            try:
                node_dict["latestTelemetry"] = json.loads(node_dict["latestTelemetry"])
                if is_offline:
                    node_dict["latestTelemetry"]["onlineState"] = "offline"
                    node_dict["latestTelemetry"]["modelStatus"] = "stopped"
                    node_dict["latestTelemetry"]["cameraFps"] = 0.0
            except Exception:
                node_dict["latestTelemetry"] = {}
        else:
            node_dict["latestTelemetry"] = {}
            if is_offline:
                node_dict["latestTelemetry"] = {
                    "onlineState": "offline",
                    "modelStatus": "stopped",
                    "cameraFps": 0.0
                }
        nodes_list.append(node_dict)
        
    return jsonify(nodes_list)

# 5. Node Current Config
@app.route("/api/labs/<lab_id>/clusters/<cluster_id>/nodes/<node_id>/config/current", methods=["GET", "PUT"])
def get_or_set_node_config(lab_id, cluster_id, node_id):
    if request.method == "GET":
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        c = conn.cursor()
        c.execute("SELECT * FROM node_config WHERE nodeId = ?", (node_id,))
        row = c.fetchone()
        conn.close()
        
        if not row:
            # Return system default if not found
            return jsonify({
                "nodeId": node_id,
                "confidenceThreshold": 90,
                "livenessThreshold": 78,
                "pinFallbackEnabled": True,
                "faceRequired": True,
                "pinRequired": True,
                "version": 1,
                "updatedBy": "system"
            })
            
        config = dict(row)
        config["pinFallbackEnabled"] = bool(config["pinFallbackEnabled"])
        config["faceRequired"] = bool(config["faceRequired"])
        config["pinRequired"] = bool(config["pinRequired"])
        return jsonify(config)
        
    else:
        # PUT Request: Update configuration
        data = request.get_json() or {}
        confidence = data.get("confidenceThreshold", 90)
        liveness = data.get("livenessThreshold", 78)
        pin_fallback = 1 if data.get("pinFallbackEnabled", True) else 0
        face_req = 1 if data.get("faceRequired", True) else 0
        pin_req = 1 if data.get("pinRequired", True) else 0
        version = data.get("version", 1) + 1
        updated_by = data.get("updatedBy", "admin")
        now_str = datetime.now().isoformat()
        
        conn = sqlite3.connect(db_path)
        c = conn.cursor()
        c.execute("""
            INSERT INTO node_config 
                (nodeId, confidenceThreshold, livenessThreshold, pinFallbackEnabled, faceRequired, pinRequired, version, updatedAt, updatedBy)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(nodeId) DO UPDATE SET
                confidenceThreshold = excluded.confidenceThreshold,
                livenessThreshold = excluded.livenessThreshold,
                pinFallbackEnabled = excluded.pinFallbackEnabled,
                faceRequired = excluded.faceRequired,
                pinRequired = excluded.pinRequired,
                version = excluded.version,
                updatedAt = excluded.updatedAt,
                updatedBy = excluded.updatedBy
        """, (node_id, confidence, liveness, pin_fallback, face_req, pin_req, version, now_str, updated_by))
        
        # Also increment manifest / config version in nodes table to signal update
        c.execute("UPDATE nodes SET currentConfigVersion = ?, updatedAt = ? WHERE id = ?", (version, now_str, node_id))
        conn.commit()
        conn.close()
        
        return jsonify({"success": True, "version": version})

# 6. Historical Access Events List
@app.route("/api/labs/<lab_id>/access-events", methods=["GET"])
def get_access_events(lab_id):
    limit = request.args.get("limit", 50, type=int)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute("SELECT * FROM access_events WHERE labId = ? ORDER BY id DESC LIMIT ?", (lab_id, limit))
    rows = c.fetchall()
    conn.close()
    
    events_list = []
    for row in rows:
        ev = dict(row)
        ev["id"] = str(ev["id"])
        ev["pinFallbackUsed"] = bool(ev["pinFallbackUsed"])
        events_list.append(ev)
        
    return jsonify(events_list)

# 7. Active Incidents List
@app.route("/api/labs/<lab_id>/incidents", methods=["GET"])
def get_incidents(lab_id):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute("SELECT * FROM incidents WHERE labId = ? AND status = 'open' ORDER BY id DESC", (lab_id,))
    rows = c.fetchall()
    conn.close()
    
    incidents_list = [dict(row) for row in rows]
    return jsonify(incidents_list)

# 8. Lab Users List
@app.route("/api/labs/<lab_id>/users", methods=["GET"])
def get_users(lab_id):
    # Retrieve all users (since everything is local, we list all SQLite users)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute("SELECT id, name, university_id, email, role, status, faceStatus, pinStatus, pin, createdAt FROM users")
    rows = c.fetchall()
    conn.close()
    
    users_list = []
    for row in rows:
        u = dict(row)
        u["id"] = str(u["id"])
        u["fullName"] = u["name"] or "Unnamed"
        u["roles"] = [u["role"]] if u["role"] else ["student"]
        users_list.append(u)
        
    return jsonify(users_list)

# 9. Enroll New User from Web App
@app.route("/api/labs/<lab_id>/enroll", methods=["POST"])
def enroll_user(lab_id):
    full_name = request.form.get("fullName")
    university_id = request.form.get("universityId")
    email = request.form.get("email")
    role = request.form.get("role", "student")
    pin = request.form.get("pin", "")
    
    if not full_name or not university_id or not email:
        return jsonify({"error": "Full Name, University ID, and Email are required"}), 400
        
    # Check photos upload
    uploaded_files = request.files.getlist("photos")
    if not uploaded_files or len(uploaded_files) == 0:
        return jsonify({"error": "At least 1 face photo is required for enrollment"}), 400
        
    # Create local folder for user photos
    user_photos_dir = os.path.join(db_dir, full_name)
    os.makedirs(user_photos_dir, exist_ok=True)
    
    # Save photos as face_0.jpg, face_1.jpg, etc.
    saved_paths = []
    for idx, file in enumerate(uploaded_files):
        img_filename = f"face_{idx}.jpg"
        save_path = os.path.join(user_photos_dir, img_filename)
        file.save(save_path)
        saved_paths.append(save_path)
        
    # Save user details to SQLite (with embedding as NULL)
    # The AutoSyncManager (auto_sync_service.py) will automatically scan the folder,
    # calculate the embeddings on NPU in the background, update SQLite, and compile db.bin!
    try:
        db.save_full_user(
            name=full_name,
            university_id=university_id,
            email=email,
            password="", # local users don't need admin dashboard passwords
            role=role,
            status="active",
            pin=pin,
            embedding=None  # triggers auto-sync background processing
        )
    except Exception as e:
        return jsonify({"error": f"Failed to save user in SQLite: {str(e)}"}), 500
        
    return jsonify({
        "success": True, 
        "message": f"Successfully enrolled {full_name}. Biometric templates will compile in background.",
        "photosCount": len(saved_paths)
    })

# 9b. Delete User Profile
@app.route("/api/labs/<lab_id>/users/<user_id>", methods=["DELETE"])
def delete_lab_user(lab_id, user_id):
    conn = sqlite3.connect(db_path)
    c = conn.cursor()
    c.execute("SELECT name FROM users WHERE id = ?", (user_id,))
    row = c.fetchone()
    conn.close()
    
    if not row:
        return jsonify({"error": "User not found"}), 404
        
    full_name = row[0]
    
    # Delete from database
    db.delete_user(full_name)
    
    # Delete from Qdrant if client is available
    if qdrant_client is not None:
        try:
            qdrant_client.delete(
                collection_name=QDRANT_COLLECTION,
                points_selector=[int(user_id)]
            )
            logger.info(f"Deleted user '{full_name}' (ID: {user_id}) from Qdrant successfully.")
        except Exception as qe:
            logger.warning(f"Failed to delete user '{full_name}' from Qdrant: {qe}")
    
    # Delete local folder for user photos
    user_photos_dir = os.path.join(db_dir, full_name)
    if os.path.exists(user_photos_dir):
        import shutil
        try:
            shutil.rmtree(user_photos_dir)
        except Exception as e:
            logger.error(f"Failed to delete photos folder for {full_name}: {e}")
            
    return jsonify({"success": True, "message": f"Successfully deleted {full_name}"})

# ── EDGE SYNC API ENDPOINTS ───────────────────────────────────────────────────

# 10. List user photos filenames
@app.route("/api/users/<full_name>/photos", methods=["GET"])
def list_user_photos(full_name):
    user_dir = os.path.join(db_dir, full_name)
    if not os.path.exists(user_dir):
        return jsonify([])
    files = [f for f in os.listdir(user_dir) if f.lower().endswith(('.png', '.jpg', '.jpeg'))]
    return jsonify(files)

# 11. Download raw photo file
@app.route("/api/users/<full_name>/photos/<filename>", methods=["GET"])
def get_user_photo(full_name, filename):
    user_dir = os.path.join(db_dir, full_name)
    if not os.path.exists(os.path.join(user_dir, filename)):
        return jsonify({"error": "Photo not found"}), 404
    return send_from_directory(user_dir, filename)

# 12. Upload computed biometric embedding
@app.route("/api/users/<full_name>/embedding", methods=["POST"])
def upload_user_embedding(full_name):
    data = request.get_json() or {}
    emb = data.get("embedding")
    if not emb or not isinstance(emb, list):
        return jsonify({"error": "Invalid embedding payload"}), 400
    
    try:
        arr = np.array(emb, dtype=np.float32)
        db.save_user(full_name, arr)
        
        # Get user's ID from database for stable Qdrant Point ID
        conn = sqlite3.connect(db_path)
        c = conn.cursor()
        c.execute("SELECT id FROM users WHERE name = ?", (full_name,))
        row = c.fetchone()
        conn.close()
        
        if row and qdrant_client is not None:
            user_id = row[0]
            try:
                from qdrant_client.models import PointStruct
                qdrant_client.upsert(
                    collection_name=QDRANT_COLLECTION,
                    points=[
                        PointStruct(
                            id=user_id,
                            vector=emb,
                            payload={"name": full_name}
                        )
                    ]
                )
                logger.info(f"Upserted vector for user '{full_name}' (ID: {user_id}) to Qdrant successfully.")
            except Exception as qe:
                logger.warning(f"Failed to upsert to Qdrant: {qe}")
                
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": f"Failed to save embedding: {str(e)}"}), 500

# 13. Sync logs (access events) from edge to server
@app.route("/api/labs/<lab_id>/access-events", methods=["POST"])
def submit_access_events(lab_id):
    events = request.get_json() or []
    if not isinstance(events, list):
        events = [events]
        
    conn = sqlite3.connect(db_path)
    c = conn.cursor()
    inserted_count = 0
    for ev in events:
        try:
            c.execute("""
                INSERT INTO access_events 
                    (labId, clusterId, nodeId, occurredAt, receivedAt, userId, universityId, displayName, method, result, reason, confidence, livenessScore, pinFallbackUsed, synced)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
            """, (
                lab_id, ev.get("clusterId"), ev.get("nodeId"), ev.get("occurredAt"), datetime.now().isoformat(),
                ev.get("userId"), ev.get("universityId"), ev.get("displayName"), ev.get("method"), ev.get("result"),
                ev.get("reason"), ev.get("confidence"), ev.get("livenessScore"), 1 if ev.get("pinFallbackUsed") else 0
            ))
            inserted_count += 1
        except Exception as e:
            logger.error(f"Error saving synced access event: {e}")
    conn.commit()
    conn.close()
    return jsonify({"success": True, "count": inserted_count})

# 14. Sync security incidents from edge to server
@app.route("/api/labs/<lab_id>/incidents", methods=["POST"])
def submit_incidents(lab_id):
    incidents = request.get_json() or []
    if not isinstance(incidents, list):
        incidents = [incidents]
        
    conn = sqlite3.connect(db_path)
    c = conn.cursor()
    inserted_count = 0
    for inc in incidents:
        try:
            c.execute("""
                INSERT INTO incidents 
                    (labId, clusterId, nodeId, type, severity, status, summary, createdAt, synced)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
            """, (
                lab_id, inc.get("clusterId"), inc.get("nodeId"), inc.get("type"), inc.get("severity"),
                inc.get("status", "open"), inc.get("summary"), inc.get("createdAt")
            ))
            inserted_count += 1
        except Exception as e:
            logger.error(f"Error saving synced incident: {e}")
    conn.commit()
    conn.close()
    return jsonify({"success": True, "count": inserted_count})

# 15. Submit edge node telemetry
@app.route("/api/labs/<lab_id>/nodes/<node_id>/telemetry", methods=["POST"])
def submit_telemetry(lab_id, node_id):
    data = request.get_json() or {}
    status = data.get("status", "online")
    online_state = data.get("onlineState", "online")
    camera_fps = data.get("cameraFps", 0.0)
    cpu_percent = data.get("cpuPercent", 0.0)
    ram_percent = data.get("ramPercent", 0.0)
    temp_c = data.get("temperatureC", 0.0)
    
    try:
        db.update_node_telemetry(
            nodeId=node_id,
            status=status,
            onlineState=online_state,
            cameraFps=camera_fps,
            cpuPercent=cpu_percent,
            ramPercent=ram_percent,
            temperatureC=temp_c,
            labId=lab_id
        )
        
        # Check if IR frame is actively requested (within last 10 seconds)
        last_req = active_ir_streams.get(node_id, 0.0)
        request_ir = (datetime.now().timestamp() - last_req) < 10.0
        
        return jsonify({"success": True, "requestIrFrame": request_ir})
    except Exception as e:
        return jsonify({"error": f"Failed to update telemetry: {str(e)}"}), 500

# 15b. IR Livestreaming endpoints
@app.route("/api/labs/<lab_id>/nodes/<node_id>/ir-stream/start", methods=["POST"])
def start_ir_stream(lab_id, node_id):
    active_ir_streams[node_id] = datetime.now().timestamp()
    logger.info(f"IR livestream requested for node {node_id}")
    return jsonify({"success": True})

@app.route("/api/labs/<lab_id>/nodes/<node_id>/ir-stream/stop", methods=["POST"])
def stop_ir_stream(lab_id, node_id):
    active_ir_streams.pop(node_id, None)
    logger.info(f"IR livestream stopped for node {node_id}")
    return jsonify({"success": True})

@app.route("/api/labs/<lab_id>/nodes/<node_id>/ir-frame", methods=["POST"])
def upload_ir_frame(lab_id, node_id):
    jpeg_bytes = request.data
    if not jpeg_bytes:
        return jsonify({"error": "No frame bytes received"}), 400
    latest_frames[node_id] = jpeg_bytes
    return jsonify({"success": True})

@app.route("/api/labs/<lab_id>/nodes/<node_id>/ir-stream", methods=["GET"])
def get_ir_stream(lab_id, node_id):
    import time
    def gen():
        active_ir_streams[node_id] = datetime.now().timestamp()
        try:
            while True:
                active_ir_streams[node_id] = datetime.now().timestamp()
                frame = latest_frames.get(node_id)
                if frame:
                    yield (b'--frame\r\n'
                           b'Content-Type: image/jpeg\r\n\r\n' + frame + b'\r\n')
                time.sleep(0.05)
        finally:
            active_ir_streams.pop(node_id, None)
            logger.info(f"Client disconnected from IR stream of node {node_id}")
    return Response(gen(), mimetype='multipart/x-mixed-replace; boundary=frame')


# 16. Get node config directly
@app.route("/api/labs/<lab_id>/nodes/<node_id>/config", methods=["GET"])
def get_node_config_direct(lab_id, node_id):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute("SELECT * FROM node_config WHERE nodeId = ?", (node_id,))
    row = c.fetchone()
    conn.close()
    
    if not row:
        return jsonify({
            "nodeId": node_id,
            "confidenceThreshold": 90,
            "livenessThreshold": 78,
            "pinFallbackEnabled": True,
            "faceRequired": True,
            "pinRequired": True,
            "version": 1,
            "updatedBy": "system"
        })
    config = dict(row)
    config["pinFallbackEnabled"] = bool(config["pinFallbackEnabled"])
    config["faceRequired"] = bool(config["faceRequired"])
    config["pinRequired"] = bool(config["pinRequired"])
    return jsonify(config)

# 17. Get computed biometric embedding
@app.route("/api/users/<full_name>/embedding", methods=["GET"])
def get_user_embedding(full_name):
    conn = sqlite3.connect(db_path, detect_types=sqlite3.PARSE_DECLTYPES)
    c = conn.cursor()
    c.execute("SELECT embedding FROM users WHERE name = ? AND embedding IS NOT NULL", (full_name,))
    row = c.fetchone()
    conn.close()
    
    if not row or row[0] is None:
        return jsonify({"error": "Embedding not found"}), 404
        
    emb_list = row[0].tolist()
    return jsonify({"embedding": emb_list})

# 18. Identify Face from Embedding (Vector Search via Qdrant)
@app.route("/api/users/identify", methods=["POST"])
def identify_face():
    if qdrant_client is None:
        return jsonify({"error": "Qdrant vector search is not initialized"}), 503
        
    data = request.get_json() or {}
    emb = data.get("embedding")
    limit = int(data.get("limit", 1))
    threshold = float(data.get("threshold", 0.0))
    
    if not emb or not isinstance(emb, list):
        return jsonify({"error": "Invalid embedding"}), 400
        
    try:
        search_results = qdrant_client.search(
            collection_name=QDRANT_COLLECTION,
            query_vector=emb,
            limit=limit
        )
        
        matches = []
        for res in search_results:
            if res.score >= threshold:
                matches.append({
                    "id": res.id,
                    "name": res.payload.get("name"),
                    "score": res.score
                })
                
        return jsonify({"matches": matches})
    except Exception as e:
        return jsonify({"error": f"Search failed: {str(e)}"}), 500

if __name__ == "__main__":
    logger.info("=== STARTING OFFLINE ACCESS CONTROL API SERVER ===")
    logger.info(f"Database Path: {db_path}")
    logger.info(f"Web Static Files Path: {static_dir}")
    logger.info("Running locally on http://0.0.0.0:5000")
    app.run(host="0.0.0.0", port=5000, debug=True)
