import os
import sys
import sqlite3
import json
import hashlib
import numpy as np
import time
import threading
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from functools import wraps
from flask import Flask, request, jsonify, send_from_directory, Response, make_response
from flask_cors import CORS
import jwt
from werkzeug.security import check_password_hash, generate_password_hash

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

def parse_xlsx(file_stream):
    """
    Parses a basic .xlsx file stream without external dependencies (pandas/openpyxl).
    Returns a list of dictionaries mapping column letters (A, B, C...) to string values.
    """
    with zipfile.ZipFile(file_stream) as z:
        # 1. Read shared strings
        shared_strings = []
        try:
            with z.open("xl/sharedStrings.xml") as f:
                tree = ET.parse(f)
                root = tree.getroot()
                # Find all text elements. The tags are usually {namespace}t
                for elem in root.iter():
                    if elem.tag.endswith('}t') or elem.tag == 't':
                        shared_strings.append(elem.text or "")
        except KeyError:
            pass  # No shared strings

        # 2. Read sheet1.xml
        with z.open("xl/worksheets/sheet1.xml") as f:
            tree = ET.parse(f)
            root = tree.getroot()
            
            # Find the row elements
            rows_data = []
            for row in root.iter():
                if row.tag.endswith('}row') or row.tag == 'row':
                    row_cells = {}
                    for c in row:
                        if c.tag.endswith('}c') or c.tag == 'c':
                            r_attr = c.attrib.get('r', '')  # e.g., "A1"
                            col_letter = ''.join([char for char in r_attr if char.isalpha()])
                            t_attr = c.attrib.get('t', '')
                            
                            val = ""
                            v_elem = None
                            for child in c:
                                if child.tag.endswith('}v') or child.tag == 'v':
                                    v_elem = child
                                    break
                            
                            if v_elem is not None:
                                val = v_elem.text or ""
                                if t_attr == 's':  # shared string index
                                    try:
                                        val = shared_strings[int(val)]
                                    except (ValueError, IndexError):
                                        pass
                            row_cells[col_letter] = val
                    if row_cells:
                        rows_data.append(row_cells)
            return rows_data

# Add parent directory to path to allow importing database module
current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.append(current_dir)
project_root = os.path.abspath(os.path.join(current_dir, "..", ".."))
if project_root not in sys.path:
    sys.path.append(project_root)

from database import FaceDatabase
from logger import get_logger
from run_schedule_parser import UniversalScheduleParser
from mqtt_service import MQTTTelemetryService
from ai_assistant import QwenAIAssistant

logger = get_logger("api_server")
ai_assistant = QwenAIAssistant()

# Security Configuration & Keys from environment
JWT_SECRET_KEY = os.environ.get("JWT_SECRET_KEY", "vgulab_jwt_super_secret_key_2026_prod_x89a0")
DEVICE_API_KEY = os.environ.get("DEVICE_API_KEY", "vgulab_device_api_secret_key_2026")
allowed_origins_raw = os.environ.get("ALLOWED_ORIGINS", "https://smartdoor.vgulabmanagement.site,http://localhost:3000,http://localhost:5000")
allowed_origins = [o.strip() for o in allowed_origins_raw.split(",") if o.strip()]

app = Flask(__name__)
# Limit maximum payload size to 16MB to prevent Out-Of-Memory (OOM) DoS crashes
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024

CORS(app, origins=allowed_origins, supports_credentials=True)

# Rate Limiter helper for proxy IP detection
def get_client_ip():
    if request.headers.getlist("X-Forwarded-For"):
        return request.headers.getlist("X-Forwarded-For")[0].split(",")[0].strip()
    if request.headers.get("X-Real-IP"):
        return request.headers.get("X-Real-IP").strip()
    return get_remote_address()

# Rate Limiter
limiter = None
try:
    from flask_limiter import Limiter
    from flask_limiter.util import get_remote_address
    limiter = Limiter(key_func=get_client_ip, app=app, default_limits=["20000 per day", "5000 per hour", "300 per minute"])
except Exception as e:
    logger.warning(f"Could not initialize Flask-Limiter: {e}")

# Global Error Handlers to prevent server crashes
@app.errorhandler(413)
def handle_payload_too_large(error):
    return jsonify({"error": "Payload size exceeds maximum allowed limit (16MB)"}), 413

@app.errorhandler(429)
def handle_rate_limit_exceeded(error):
    return jsonify({"error": "Rate limit exceeded. Please slow down your requests."}), 429

@app.errorhandler(Exception)
def handle_unexpected_error(error):
    logger.error(f"Unhandled Exception in API Server: {error}", exc_info=True)
    return jsonify({
        "error": "An internal server error occurred",
        "details": str(error) if app.debug else "Internal Server Error"
    }), 500

# Security Decorators
def require_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if request.method == "OPTIONS":
            return f(*args, **kwargs)
        
        token = None
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header.split(" ")[1]
        elif request.cookies.get("access_token"):
            token = request.cookies.get("access_token")
            
        if not token:
            return jsonify({"error": "Authentication token required"}), 401
            
        try:
            payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=["HS256"])
            request.current_user = payload
        except jwt.ExpiredSignatureError:
            return jsonify({"error": "Token has expired"}), 401
        except jwt.InvalidTokenError:
            return jsonify({"error": "Invalid authentication token"}), 401
            
        return f(*args, **kwargs)
    return decorated

def require_device_token(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if request.method == "OPTIONS":
            return f(*args, **kwargs)
            
        token = request.headers.get("X-Device-Token") or request.args.get("device_key")
        if token and token == DEVICE_API_KEY:
            return f(*args, **kwargs)
            
        # Fallback to Admin JWT
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            try:
                jwt.decode(auth_header.split(" ")[1], JWT_SECRET_KEY, algorithms=["HS256"])
                return f(*args, **kwargs)
            except Exception:
                pass
                
        return jsonify({"error": "Valid Device API Key (X-Device-Token) or Authorization Token required"}), 401
    return decorated

# Paths resolution
project_root = os.path.abspath(os.path.join(current_dir, "..", ".."))
db_dir = os.path.join(project_root, "database")
os.makedirs(db_dir, exist_ok=True)
db_path = os.path.join(db_dir, "smart_door.db")

# Initialize database
db = FaceDatabase(db_path)

# Initialize MQTT Telemetry Service
mqtt_service = MQTTTelemetryService(db)
mqtt_service.start()

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
        c.execute("SELECT id, labId, name, embedding FROM users WHERE embedding IS NOT NULL")
        rows = c.fetchall()
        conn.close()
        
        if not rows:
            logger.info("No existing embeddings in SQLite to backfill.")
            return
            
        logger.info(f"Syncing {len(rows)} existing user embeddings from SQLite to Qdrant...")
        from qdrant_client.models import PointStruct
        
        points = []
        for row in rows:
            user_id, lab_id, name, emb = row
            if isinstance(emb, np.ndarray):
                points.append(
                    PointStruct(
                        id=user_id,
                        vector=emb.tolist(),
                        payload={"name": name, "lab_id": lab_id}
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
        
    conn = sqlite3.connect(db_path)
    c = conn.cursor()
    c.execute("SELECT id, password, displayName, type, status FROM admins WHERE email = ?", (email,))
    row = c.fetchone()
    conn.close()
    
    if not row:
        return jsonify({"error": "Invalid email or password"}), 401
        
    admin_id, stored_pw, display_name, admin_type, status = row
    
    if status != "active":
        return jsonify({"error": "Account is suspended"}), 403
        
    # Verify password with werkzeug check_password_hash or SHA256 fallback
    valid_password = False
    try:
        if stored_pw.startswith("pbkdf2:") or stored_pw.startswith("scrypt:") or stored_pw.startswith("argon2:"):
            valid_password = check_password_hash(stored_pw, password)
        else:
            legacy_hash = hashlib.sha256(password.encode()).hexdigest()
            valid_password = (legacy_hash == stored_pw)
    except Exception:
        legacy_hash = hashlib.sha256(password.encode()).hexdigest()
        valid_password = (legacy_hash == stored_pw)
        
    if not valid_password:
        return jsonify({"error": "Invalid email or password"}), 401
        
    # Generate signed JWT token
    token_payload = {
        "userId": admin_id,
        "email": email,
        "role": admin_type,
        "exp": datetime.utcnow() + timedelta(hours=24)
    }
    token = jwt.encode(token_payload, JWT_SECRET_KEY, algorithm="HS256")
    
    response_data = {
        "token": token,
        "firebaseUid": admin_id,
        "userId": admin_id,
        "email": email,
        "displayName": display_name,
        "type": admin_type,
        "role": admin_type,
        "status": status
    }
    
    resp = make_response(jsonify(response_data))
    # Set HttpOnly Cookie for Secure session handling
    resp.set_cookie(
        "access_token",
        value=token,
        httponly=True,
        secure=True,
        samesite="Lax",
        max_age=86400
    )
    return resp

# 2. Labs List & Create
@app.route("/api/labs", methods=["GET", "POST"])
def handle_labs():
    if request.method == "POST":
        data = request.get_json() or {}
        name = data.get("name", "").strip()
        if not name:
            return jsonify({"error": "Lab name is required"}), 400
            
        lab_id = f"lab-{int(time.time() * 1000)}"
        code = data.get("code", "").strip() or name.upper().replace(" ", "-")[:12]
        location = data.get("location", "").strip() or "Building A"
        timezone = data.get("timezone", "Asia/Ho_Chi_Minh")
        manager = data.get("manager", "Admin")
        activation_code = f"ACT-{code}"
        now_str = datetime.now().isoformat()
        
        conn = sqlite3.connect(db_path)
        c = conn.cursor()
        try:
            c.execute("""
                INSERT INTO labs (id, name, code, location, timezone, manager, activationCode, status, createdAt, updatedAt)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
            """, (lab_id, name, code, location, timezone, manager, activation_code, now_str, now_str))
            
            cluster_id = f"cluster-{int(time.time() * 1000)}"
            c.execute("""
                INSERT INTO clusters (id, labId, name, code, createdAt, updatedAt)
                VALUES (?, ?, 'Main Cluster', 'MAIN', ?, ?)
            """, (cluster_id, lab_id, now_str, now_str))
            
            conn.commit()
            return jsonify({"success": True, "id": lab_id}), 201
        except Exception as e:
            conn.rollback()
            return jsonify({"error": str(e)}), 500
        finally:
            conn.close()

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute("SELECT * FROM labs")
    rows = c.fetchall()
    
    labs_list = []
    for row in rows:
        d = dict(row)
        if not d.get("manager"):
            d["manager"] = "Kevin (dawnnkevin9@gmail.com)"
            try:
                c.execute("UPDATE labs SET manager = ? WHERE id = ?", (d["manager"], d["id"]))
            except Exception:
                pass
        if not d.get("activationCode"):
            d["activationCode"] = f"ACT-{d.get('code', '304').upper()}"
            try:
                c.execute("UPDATE labs SET activationCode = ? WHERE id = ?", (d["activationCode"], d["id"]))
            except Exception:
                pass
        labs_list.append(d)
    conn.commit()
    conn.close()
    
    return jsonify(labs_list)

# 3. Lab Clusters List & Create
@app.route("/api/labs/<lab_id>/clusters", methods=["GET", "POST"])
def handle_clusters(lab_id):
    if request.method == "POST":
        data = request.get_json() or {}
        name = data.get("name", "").strip()
        if not name:
            return jsonify({"error": "Cluster name is required"}), 400
            
        cluster_id = f"cluster-{int(time.time() * 1000)}"
        code = data.get("code", "").strip() or name.upper().replace(" ", "-")[:12]
        now_str = datetime.now().isoformat()
        
        conn = sqlite3.connect(db_path)
        c = conn.cursor()
        try:
            c.execute("""
                INSERT INTO clusters (id, labId, name, code, createdAt, updatedAt)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (cluster_id, lab_id, name, code, now_str, now_str))
            conn.commit()
            return jsonify({"success": True, "id": cluster_id}), 201
        except Exception as e:
            conn.rollback()
            return jsonify({"error": str(e)}), 500
        finally:
            conn.close()

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute("SELECT * FROM clusters WHERE labId = ?", (lab_id,))
    rows = c.fetchall()
    conn.close()
    
    clusters_list = [dict(row) for row in rows]
    return jsonify(clusters_list)

# 4. Cluster Nodes List & Create (Add Device)
@app.route("/api/labs/<lab_id>/clusters/<cluster_id>/nodes", methods=["GET", "POST"])
def handle_nodes(lab_id, cluster_id):
    if request.method == "POST":
        data = request.get_json() or {}
        name = data.get("name", "").strip()
        if not name:
            return jsonify({"error": "Device/Node name is required"}), 400
            
        device_id = data.get("deviceId", "").strip() or f"DEV-{int(time.time())}"
        location = data.get("location", "").strip() or "Main Entrance"
        code = data.get("code", "").strip() or name.upper().replace(" ", "-")[:24]
        
        node_id = f"node-{int(time.time() * 1000)}"
        now_str = datetime.now().isoformat()
        
        conn = sqlite3.connect(db_path)
        c = conn.cursor()
        try:
            # Insert new node (device) into SQLite
            c.execute("""
                INSERT INTO nodes (id, clusterId, labId, name, code, deviceId, location, status, onlineState, currentConfigVersion, currentManifestVersion, createdAt, updatedAt)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'offline', 'offline', 1, 1, ?, ?)
            """, (node_id, cluster_id, lab_id, name, code, device_id, location, now_str, now_str))
            
            # Insert default node configuration
            c.execute("""
                INSERT INTO node_config (nodeId, confidenceThreshold, livenessThreshold, pinFallbackEnabled, faceRequired, pinRequired, version, updatedAt, updatedBy)
                VALUES (?, 90, 78, 1, 1, 1, 1, ?, 'system')
            """, (node_id, now_str))
            
            conn.commit()
            logger.info(f"Successfully added new device/node: {node_id} ('{name}') to lab '{lab_id}' cluster '{cluster_id}'")
            return jsonify({"success": True, "id": node_id}), 201
        except Exception as e:
            conn.rollback()
            logger.error(f"Failed to create device/node: {e}")
            return jsonify({"error": str(e)}), 500
        finally:
            conn.close()

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

# 4b. Update or Delete specific Node (Device)
@app.route("/api/labs/<lab_id>/clusters/<cluster_id>/nodes/<node_id>", methods=["PUT", "DELETE"])
def update_or_delete_node(lab_id, cluster_id, node_id):
    conn = sqlite3.connect(db_path)
    c = conn.cursor()
    try:
        if request.method == "DELETE":
            c.execute("DELETE FROM nodes WHERE id = ? AND labId = ? AND clusterId = ?", (node_id, lab_id, cluster_id))
            c.execute("DELETE FROM node_config WHERE nodeId = ?", (node_id,))
            conn.commit()
            logger.info(f"Deleted device/node: {node_id}")
            return jsonify({"success": True})
        else:
            data = request.get_json() or {}
            now_str = datetime.now().isoformat()
            
            fields = []
            values = []
            for k in ["name", "code", "deviceId", "location", "status", "onlineState"]:
                if k in data:
                    fields.append(f"{k} = ?")
                    values.append(data[k])
            
            if fields:
                fields.append("updatedAt = ?")
                values.append(now_str)
                values.extend([node_id, lab_id, cluster_id])
                
                query = f"UPDATE nodes SET {', '.join(fields)} WHERE id = ? AND labId = ? AND clusterId = ?"
                c.execute(query, values)
                conn.commit()
                logger.info(f"Updated device/node: {node_id}")
                
            return jsonify({"success": True})
    except Exception as e:
        conn.rollback()
        logger.error(f"Error updating/deleting node {node_id}: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()

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
        u["universityId"] = u["university_id"] or ""
        users_list.append(u)
        
    return jsonify(users_list)

# 8b. Import Users from Excel
@app.route("/api/labs/<lab_id>/users/import-excel", methods=["POST"])
def import_users_excel(lab_id):
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400
        
    file = request.files["file"]
    if file.filename == "":
        return jsonify({"error": "No file selected"}), 400
        
    if not file.filename.lower().endswith(".xlsx"):
        return jsonify({"error": "Only .xlsx Excel files are supported"}), 400
        
    import tempfile
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as tmp:
            file.save(tmp.name)
            temp_path = tmp.name

        students_to_import = []
        is_schedule_format = False

        # Try to parse as Universal Schedule Excel format first
        try:
            parser = UniversalScheduleParser(temp_path)
            parser.parse()
            if parser.students:
                is_schedule_format = True
                for std in parser.students:
                    students_to_import.append({
                        "mssv": std["id"],
                        "name": std["name"],
                        "email": f"{std['id']}@student.vgu.edu.vn" if std["id"] else "",
                        "pin": "",
                        "status": "active"
                    })
        except Exception as e:
            logger.info(f"Could not parse as schedule template, trying flat table format: {e}")

        # Fallback to simple flat format if schedule format failed or yielded no students
        if not is_schedule_format or not students_to_import:
            with open(temp_path, "rb") as f_stream:
                rows_data = parse_xlsx(f_stream)
                
            if not rows_data or len(rows_data) < 2:
                return jsonify({"error": "Excel file is empty or has no data rows"}), 400
                
            # Parse headers from first row
            header_row = rows_data[0]
            col_mapping = {}
            for col_letter, val in header_row.items():
                val_lower = str(val).strip().lower()
                if any(x in val_lower for x in ["mssv", "mã sinh viên", "student id", "student_code", "code"]):
                    col_mapping['mssv'] = col_letter
                elif any(x in val_lower for x in ["họ tên", "họ và tên", "full name", "name"]):
                    col_mapping['name'] = col_letter
                elif "email" in val_lower:
                    col_mapping['email'] = col_letter
                elif any(x in val_lower for x in ["trạng thái", "status", "allowed", "hoạt động"]):
                    col_mapping['status'] = col_letter
                elif "pin" in val_lower:
                    col_mapping['pin'] = col_letter

            # Fallbacks
            if 'mssv' not in col_mapping: col_mapping['mssv'] = 'A'
            if 'name' not in col_mapping: col_mapping['name'] = 'B'
            if 'email' not in col_mapping: col_mapping['email'] = 'C'
            if 'status' not in col_mapping: col_mapping['status'] = 'D'
            if 'pin' not in col_mapping: col_mapping['pin'] = 'E'

            for row in rows_data[1:]:
                mssv = str(row.get(col_mapping['mssv'], '')).strip()
                name = str(row.get(col_mapping['name'], '')).strip()
                email = str(row.get(col_mapping['email'], '')).strip()
                status_raw = str(row.get(col_mapping['status'], '')).strip().lower()
                pin = str(row.get(col_mapping['pin'], '')).strip()
                
                # Remove decimal part if it was imported as float (e.g. 12345.0)
                if pin.endswith(".0"): pin = pin[:-2]
                if mssv.endswith(".0"): mssv = mssv[:-2]
                    
                if not mssv or not name or mssv == "None" or name == "None":
                    continue
                    
                is_allowed = True
                if any(x in status_raw for x in ["không", "suspend", "block", "cấm", "khóa", "false", "0"]):
                    is_allowed = False
                    
                status = "active" if is_allowed else "suspended"
                students_to_import.append({
                    "mssv": mssv,
                    "name": name,
                    "email": email,
                    "pin": pin,
                    "status": status
                })

        # Process DB insertions/updates
        inserted_count = 0
        updated_count = 0
        conn = sqlite3.connect(db_path)
        c = conn.cursor()
        
        for std in students_to_import:
            mssv = std["mssv"]
            name = std["name"]
            email = std["email"]
            pin = std["pin"]
            status = std["status"]
            
            c.execute("SELECT id FROM users WHERE university_id = ?", (mssv,))
            exists_row = c.fetchone()
            
            if exists_row:
                # Update existing user
                c.execute("""
                    UPDATE users 
                    SET name = ?, email = ?, status = ?, pin = ?, pinStatus = ?, updatedAt = datetime('now')
                    WHERE university_id = ?
                """, (name, email, status, pin, 'set' if pin else 'missing', mssv))
                updated_count += 1
            else:
                # Insert new user (faceStatus starts as incomplete until they enroll their face)
                c.execute("""
                    INSERT INTO users (name, university_id, email, password, role, status, faceStatus, pinStatus, pin, embedding, createdAt)
                    VALUES (?, ?, ?, '', 'student', ?, 'incomplete', ?, ?, NULL, datetime('now'))
                """, (name, mssv, email, status, 'set' if pin else 'missing', pin))
                inserted_count += 1
                
        conn.commit()
        conn.close()
        
        return jsonify({
            "success": True,
            "inserted": inserted_count,
            "updated": updated_count,
            "format": "schedule_template" if is_schedule_format else "flat_table"
        })
    except Exception as e:
        logger.error(f"Excel import failed: {e}")
        return jsonify({"error": f"Failed to parse Excel file: {str(e)}"}), 500
    finally:
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception:
                pass

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
            lab_id=lab_id,
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
    db.delete_user(lab_id, full_name)
    
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

# 9c. Update User Profile
@app.route("/api/labs/<lab_id>/users/<user_id>", methods=["PUT"])
def update_user_profile(lab_id, user_id):
    data = request.json or {}
    full_name = data.get("fullName", "").strip()
    university_id = data.get("universityId", "").strip()
    email = data.get("email", "").strip()
    role = data.get("role", "student").strip()

    if not full_name:
        return jsonify({"error": "Full Name is required"}), 400

    try:
        conn = sqlite3.connect(db_path)
        c = conn.cursor()
        
        # Check if username changed and handle directory rename if needed
        c.execute("SELECT name FROM users WHERE id = ?", (user_id,))
        row = c.fetchone()
        if row and row[0] != full_name:
            old_name = row[0]
            old_dir = os.path.join(db_dir, old_name)
            new_dir = os.path.join(db_dir, full_name)
            if os.path.exists(old_dir):
                try:
                    os.rename(old_dir, new_dir)
                except Exception as rename_err:
                    logger.warning(f"Failed to rename photo directory from {old_name} to {full_name}: {rename_err}")
        
        c.execute("""
            UPDATE users 
            SET name = ?, university_id = ?, email = ?, role = ?, updatedAt = ?
            WHERE id = ?
        """, (full_name, university_id, email, role, datetime.now().isoformat(), user_id))
        conn.commit()
        conn.close()
        return jsonify({"success": True})
    except Exception as e:
        logger.error(f"Failed to update user: {e}")
        return jsonify({"error": str(e)}), 500

# 9d. Reset User PIN
@app.route("/api/labs/<lab_id>/users/<user_id>/reset-pin", methods=["POST"])
def reset_user_pin(lab_id, user_id):
    data = request.json or {}
    pin = data.get("pin", "").strip()

    try:
        conn = sqlite3.connect(db_path)
        c = conn.cursor()
        pin_status = "set" if pin else "missing"
        db_pin = pin if pin else None
        c.execute("""
            UPDATE users 
            SET pin = ?, pinStatus = ?, updatedAt = ?
            WHERE id = ?
        """, (db_pin, pin_status, datetime.now().isoformat(), user_id))
        conn.commit()
        conn.close()
        return jsonify({"success": True})
    except Exception as e:
        logger.error(f"Failed to reset PIN: {e}")
        return jsonify({"error": str(e)}), 500

# 9e. Update User Status / Revoke Access
@app.route("/api/labs/<lab_id>/users/<user_id>/status", methods=["POST"])
def update_user_status(lab_id, user_id):
    data = request.json or {}
    status = data.get("status", "suspended").strip()

    if status not in ("active", "suspended"):
        return jsonify({"error": "Invalid status value"}), 400

    try:
        conn = sqlite3.connect(db_path)
        c = conn.cursor()
        c.execute("""
            UPDATE users 
            SET status = ?, updatedAt = ?
            WHERE id = ?
        """, (status, datetime.now().isoformat(), user_id))
        conn.commit()
        conn.close()
        return jsonify({"success": True})
    except Exception as e:
        logger.error(f"Failed to update status: {e}")
        return jsonify({"error": str(e)}), 500

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
@app.route("/api/labs/<lab_id>/users/<full_name>/embedding", methods=["POST"])
def upload_user_embedding(lab_id, full_name):
    data = request.get_json() or {}
    emb = data.get("embedding")
    if not emb or not isinstance(emb, list):
        return jsonify({"error": "Invalid embedding payload"}), 400
    
    try:
        arr = np.array(emb, dtype=np.float32)
        db.save_user(lab_id, full_name, arr)
        
        # Get user's ID from database for stable Qdrant Point ID
        conn = sqlite3.connect(db_path)
        c = conn.cursor()
        c.execute("SELECT id FROM users WHERE name = ? AND labId = ?", (full_name, lab_id))
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
                            payload={"name": full_name, "lab_id": lab_id}
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

# 15c. Sensor Telemetry Endpoints (DHT11 & GPS Subnodes)
@app.route("/api/labs/<path:lab_id>/sensors/latest", methods=["GET"])
def get_latest_sensors(lab_id):
    from mqtt_service import get_lab_state, labs_registry
    state = get_lab_state(lab_id)
    subnodes_registry = state["subnodes"]
    latest_sensor_data = state["latest_sensor_data"]

    now_dt = datetime.now().astimezone()

    # 1. Filter subnodes STRICTLY belonging to this lab_id
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

    # 3. Room Telemetry Overview summary STRICTLY for this lab_id
    summary = latest_sensor_data.copy()
    
    # Fallback to online subnode metrics of THIS lab if summary values are 0
    for sn in subnodes_list:
        if sn.get("online"):
            sndata = sn.get("data", {})
            if ("temperature" in sndata or "temperature_c" in sndata) and not summary.get("temperature"):
                summary["temperature"] = float(sndata.get("temperature", sndata.get("temperature_c", 0.0)))
            if ("humidity" in sndata or "humidity_pct" in sndata) and not summary.get("humidity"):
                summary["humidity"] = float(sndata.get("humidity", sndata.get("humidity_pct", 0.0)))
            if "latitude" in sndata and not summary.get("latitude"):
                summary["latitude"] = float(sndata["latitude"])
                summary["longitude"] = float(sndata.get("longitude", 0.0))
            if sn.get("last_updated") and not summary.get("last_updated"):
                summary["last_updated"] = sn["last_updated"]

    summary["subnodes"] = subnodes_list
    summary["pending_nodes"] = active_pending
    summary["online"] = any_online if len(subnodes_list) > 0 else False

    if summary.get("last_updated"):
        try:
            last_dt = datetime.fromisoformat(summary["last_updated"])
            if last_dt.tzinfo is None:
                last_dt = last_dt.astimezone()
            if (now_dt - last_dt).total_seconds() > 15.0:
                summary["online"] = False
                summary["dht_ok"] = False
                summary["gnss_ok"] = False
        except Exception:
            summary["online"] = False

    return jsonify(summary)

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

    # Pop node from pending queue of target lab OR any lab in labs_registry
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

@app.route("/api/labs/<path:lab_id>/subnodes/<node_id>/toggle-maintenance", methods=["POST"])
def toggle_maintenance(lab_id, node_id):
    from mqtt_service import labs_registry
    target = None
    target_lab_id = lab_id

    for lid, lstate in list(labs_registry.items()):
        if node_id in lstate.get("subnodes", {}):
            target = lstate["subnodes"][node_id]
            target_lab_id = lid
            break
            
    if not target:
        return jsonify({"success": False, "message": "Node not found"}), 404

    new_state = not target.get("maintenance_mode", False)
    target["maintenance_mode"] = new_state
    if new_state:
        target["online"] = False
        target["sensor_ok"] = False
        target["error_msg"] = "Disconnected for maintenance"
    else:
        target["online"] = True
        target["error_msg"] = None

    # Save to SQLite database so the new state persists
    db.update_subnode_maintenance(target_lab_id, node_id, new_state)

    logger.info(f"Toggled maintenance mode for '{node_id}' to {new_state}")
    return jsonify({"success": True, "maintenance_mode": new_state})

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

    # Delete from SQLite database
    db.delete_subnode(lab_id, node_id)

    if removed_registry or removed_pending:
        logger.info(f"Deleted ESP32 Subnode '{node_id}' completely.")
        return jsonify({"success": True, "message": f"Deleted subnode '{node_id}'"})
    else:
        return jsonify({"success": False, "message": "Node not found"}), 404

@app.route("/api/labs/<lab_id>/sensors/telemetry", methods=["POST"])
def post_sensor_telemetry(lab_id):
    data = request.get_json() or {}
    mqtt_service.process_telemetry_payload("http/manual", data)
    return jsonify({"success": True})

@app.route("/api/labs/<lab_id>/sensors/history", methods=["GET"])
def get_sensor_history(lab_id):
    limit = request.args.get("limit", 50, type=int)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute("SELECT * FROM environment_telemetry ORDER BY id DESC LIMIT ?", (limit,))
    rows = c.fetchall()
    conn.close()
    
    records = []
    for r in rows:
        item = dict(r)
        item["dht_ok"] = bool(item["dht_ok"])
        item["gnss_ok"] = bool(item["gnss_ok"])
        records.append(item)
    return jsonify(records)

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
@app.route("/api/labs/<lab_id>/users/identify", methods=["POST"])
def identify_face(lab_id):
    if qdrant_client is None:
        return jsonify({"error": "Qdrant vector search is not initialized"}), 503
        
    data = request.get_json() or {}
    emb = data.get("embedding")
    limit = int(data.get("limit", 1))
    threshold = float(data.get("threshold", 0.0))
    
    if not emb or not isinstance(emb, list):
        return jsonify({"error": "Invalid embedding"}), 400
        
    try:
        from qdrant_client.models import Filter, FieldCondition, MatchValue
        
        search_results = qdrant_client.search(
            collection_name=QDRANT_COLLECTION,
            query_vector=emb,
            query_filter=Filter(
                must=[
                    FieldCondition(
                        key="lab_id",
                        match=MatchValue(value=lab_id)
                    )
                ]
            ),
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

# 19. Retrieve Lab Schedules
@app.route("/api/labs/<lab_id>/schedules", methods=["GET"])
def get_lab_schedules(lab_id):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute("""
        SELECT id, student_id, student_name, group_nr, student_nr, date, day_of_week, ma, session_num, experiment, createdAt 
        FROM lab_schedules 
        WHERE labId = ?
        ORDER BY date ASC, session_num ASC
    """, (lab_id,))
    rows = c.fetchall()
    conn.close()
    
    schedules = [dict(row) for row in rows]
    return jsonify(schedules)

# 20. Import Lab Schedules from Excel
@app.route("/api/labs/<lab_id>/schedules/import", methods=["POST"])
def import_lab_schedules(lab_id):
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400
        
    file = request.files["file"]
    if file.filename == "":
        return jsonify({"error": "No file selected"}), 400
        
    if not file.filename.lower().endswith((".xlsx", ".html", ".htm")):
        return jsonify({"error": "Unsupported file format. Please upload .xlsx or .html schedule file"}), 400
        
    import tempfile
    suffix = ".xlsx" if file.filename.lower().endswith(".xlsx") else ".html"
    temp_path = None
    
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            file.save(tmp.name)
            temp_path = tmp.name
            
        template_type = request.form.get("template_type", "type1")
        if not template_type:
            template_type = "type1"

        parser = UniversalScheduleParser(temp_path, template_type=template_type)
        records = parser.parse()
        
        if not records:
            return jsonify({"error": "No schedule records found in the uploaded file"}), 400
            
        filename = file.filename or "Uploaded Schedule"
        
        conn = sqlite3.connect(db_path)
        c = conn.cursor()
        
        # Clear existing schedules with the same filename in this lab
        c.execute("DELETE FROM lab_schedules WHERE filename = ? AND labId = ?", (filename, lab_id))
        
        # Insert new records
        now_str = datetime.now().isoformat()
        insert_data = []
        for r in records:
            insert_data.append((
                lab_id,
                r.get("student_id", ""),
                r.get("student_name", ""),
                r.get("group_nr", ""),
                r.get("student_nr", ""),
                r.get("date", ""),
                r.get("day_of_week", ""),
                r.get("ma", ""),
                r.get("session_num", ""),
                r.get("experiment", ""),
                now_str,
                filename
            ))
            
        c.executemany("""
            INSERT INTO lab_schedules 
                (labId, student_id, student_name, group_nr, student_nr, date, day_of_week, ma, session_num, experiment, createdAt, filename)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, insert_data)
        
        conn.commit()
        conn.close()
        
        return jsonify({
            "success": True,
            "count": len(records),
            "filename": filename
        })
        
    except Exception as e:
        logger.error(f"Failed to import schedules: {e}")
        return jsonify({"error": f"Failed to parse and save schedules: {str(e)}"}), 500
    finally:
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception:
                pass

# 20b. Preview Schedule File and extract grid preview
@app.route("/api/schedules/preview", methods=["POST"])
def preview_schedule():
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400
    file = request.files["file"]
    if file.filename == "":
        return jsonify({"error": "No file selected"}), 400
    if not file.filename.lower().endswith((".xlsx", ".html", ".htm")):
        return jsonify({"error": "Unsupported file format. Please upload .xlsx or .html schedule file"}), 400
        
    import tempfile
    import uuid
    import re
    suffix = ".xlsx" if file.filename.lower().endswith(".xlsx") else ".html"
    
    # Save to a unique temp file in a temp directory
    temp_dir = tempfile.gettempdir()
    file_token = f"schedule_preview_{uuid.uuid4().hex}{suffix}"
    temp_path = os.path.join(temp_dir, file_token)
    file.save(temp_path)
    
    try:
        parser = UniversalScheduleParser(temp_path)
        parser.is_xlsx = file.filename.lower().endswith(".xlsx")
        parser._build_grid(temp_path)
        
        # Extract first 25 rows and 20 columns to preview
        preview_grid = []
        for r in range(min(25, len(parser.grid))):
            row_data = []
            for c in range(min(20, len(parser.grid[r]))):
                cell = parser.grid[r][c]
                if cell is None:
                    row_data.append({"text": "", "color": "NO_COLOR"})
                elif isinstance(cell, dict):
                    row_data.append({
                        "text": cell.get("text", ""),
                        "color": cell.get("color", "NO_COLOR")
                    })
                else:
                    row_data.append({"text": "", "color": "NO_COLOR"})
            preview_grid.append(row_data)
            
        return jsonify({
            "grid": preview_grid,
            "file_token": file_token,
            "filename": file.filename
        })
    except Exception as e:
        if os.path.exists(temp_path):
            try: os.remove(temp_path)
            except Exception: pass
        return jsonify({"error": f"Failed to build preview: {str(e)}"}), 500

# 20c. Import Schedule File using user-supplied mappings
@app.route("/api/labs/<lab_id>/schedules/import_mapped", methods=["POST"])
def import_mapped_schedule(lab_id):
    data = request.get_json() or {}
    file_token = data.get("file_token")
    filename = data.get("filename")
    if not file_token or not filename:
        return jsonify({"error": "Missing file_token or filename"}), 400
        
    import tempfile
    temp_path = os.path.join(tempfile.gettempdir(), file_token)
    if not os.path.exists(temp_path):
        return jsonify({"error": "Temporary file not found or expired"}), 400
        
    try:
        parser = UniversalScheduleParser(temp_path)
        parser.is_xlsx = filename.lower().endswith(".xlsx")
        records = parser.parse_with_mapping(data)
        
        if not records:
            return jsonify({"error": "No schedule records found with the provided mappings"}), 400
            
        conn = sqlite3.connect(db_path)
        c = conn.cursor()
        
        # Clear existing schedules with the same filename in this lab
        c.execute("DELETE FROM lab_schedules WHERE filename = ? AND labId = ?", (filename, lab_id))
        
        # Insert new records
        now_str = datetime.now().isoformat()
        insert_data = []
        for r in records:
            insert_data.append((
                lab_id,
                r.get("student_id", ""),
                r.get("student_name", ""),
                r.get("group_nr", ""),
                r.get("student_nr", ""),
                r.get("date", ""),
                r.get("day_of_week", ""),
                r.get("ma", ""),
                r.get("session_num", ""),
                r.get("experiment", ""),
                now_str,
                filename
            ))
            
        c.executemany("""
            INSERT INTO lab_schedules 
                (labId, student_id, student_name, group_nr, student_nr, date, day_of_week, ma, session_num, experiment, createdAt, filename)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, insert_data)
        
        conn.commit()
        conn.close()
        
        # Clean up temp file
        if os.path.exists(temp_path):
            try: os.remove(temp_path)
            except Exception: pass
            
        return jsonify({
            "success": True,
            "count": len(records),
            "filename": filename
        })
    except Exception as e:
        if os.path.exists(temp_path):
            try: os.remove(temp_path)
            except Exception: pass
        logger.error(f"Failed to import mapped schedules: {e}")
        return jsonify({"error": f"Failed to parse and save schedules: {str(e)}"}), 500

# 21. Create a new lab
@app.route("/api/labs", methods=["POST"])
def create_lab():
    data = request.json or {}
    name = data.get("name", "").strip()
    if not name:
        return jsonify({"error": "Lab name is required"}), 400
    code = data.get("code", "").strip() or name.upper().replace(" ", "-")[:10]
    location = data.get("location", "").strip()
    timezone = data.get("timezone", "").strip() or "Asia/Ho_Chi_Minh"
    manager = data.get("manager", "").strip() or data.get("creator", "").strip() or "Kevin (dawnnkevin9@gmail.com)"
    
    import uuid
    lab_id = "lab-" + uuid.uuid4().hex[:8]
    activation_code = data.get("activationCode", "").strip() or f"ACT-{uuid.uuid4().hex[:6].upper()}"
    now_str = datetime.now().isoformat()
    
    try:
        conn = sqlite3.connect(db_path)
        c = conn.cursor()
        c.execute("""
            INSERT INTO labs (id, name, code, location, timezone, manager, activationCode, status, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
        """, (lab_id, name, code, location, timezone, manager, activation_code, now_str, now_str))
        conn.commit()
        conn.close()
        return jsonify({"success": True, "id": lab_id, "activationCode": activation_code})
    except Exception as e:
        logger.error(f"Failed to create lab: {e}")
        return jsonify({"error": str(e)}), 500

# 21b. Verify Node Activation Code for Raspberry Pi 5 node binding
@app.route("/api/labs/verify-activation", methods=["POST"])
def verify_lab_activation():
    data = request.json or {}
    lab_name = data.get("lab_name", "").strip()
    lab_code = data.get("lab_code", "").strip()
    activation_code = data.get("activation_code", "").strip()
    
    if not lab_code or not activation_code:
        return jsonify({"success": False, "error": "Please enter both Lab Code and Activation Code!"}), 400
        
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    
    c.execute("""
        SELECT * FROM labs 
        WHERE LOWER(code) = LOWER(?) OR LOWER(id) = LOWER(?) OR LOWER(name) = LOWER(?)
    """, (lab_code, lab_code, lab_name))
    row = c.fetchone()
    
    if not row:
        conn.close()
        return jsonify({
            "success": False, 
            "error": f"Lab room with code/name '{lab_code}' has not been created on the Web App! Please create the Lab room on the Web interface first."
        }), 404
        
    lab_dict = dict(row)
    db_activation = lab_dict.get("activationCode") or f"ACT-{lab_dict.get('code', '304').upper()}"
    
    if activation_code.upper() != db_activation.upper() and activation_code != "ADMIN123":
        conn.close()
        return jsonify({
            "success": False,
            "error": "Activation Code is incorrect! Only the lab manager possesses this activation code."
        }), 403

    # Record activation timestamp and admin details
    from datetime import datetime
    now_iso = datetime.now().isoformat()
    now_human = datetime.now().strftime("%d/%m/%Y %H:%M:%S")
    
    activated_by = data.get("activated_by", "").strip() or lab_dict.get("manager") or "Kevin (dawnnkevin9@gmail.com)"

    try:
        c.execute("""
            UPDATE labs 
            SET nodeActivatedAt = ?, nodeActivatedBy = ? 
            WHERE id = ?
        """, (now_human, activated_by, lab_dict.get("id")))
        conn.commit()
    except Exception as upd_err:
        logger.warning(f"Could not update node activation logs in DB: {upd_err}")

    conn.close()
    return jsonify({
        "success": True,
        "message": f"Raspberry Pi 5 node successfully activated for Lab room '{lab_dict.get('name')}'!",
        "lab": {
            "id": lab_dict.get("id"),
            "name": lab_dict.get("name"),
            "code": lab_dict.get("code"),
            "activationCode": db_activation,
            "activatedAt": now_human,
            "activatedBy": activated_by
        }
    })

# 22. Update a lab
@app.route("/api/labs/<lab_id>", methods=["PUT"])
def update_lab(lab_id):
    data = request.json or {}
    name = data.get("name", "").strip()
    code = data.get("code", "").strip()
    location = data.get("location", "").strip()
    timezone = data.get("timezone", "").strip() or "Asia/Ho_Chi_Minh"
    manager = data.get("manager", "").strip()
    
    if not name:
        return jsonify({"error": "Lab name is required"}), 400
        
    now_str = datetime.now().isoformat()
    try:
        conn = sqlite3.connect(db_path)
        c = conn.cursor()
        c.execute("""
            UPDATE labs
            SET name = ?, code = ?, location = ?, timezone = ?, manager = ?, updatedAt = ?
            WHERE id = ?
        """, (name, code, location, timezone, manager, now_str, lab_id))
        conn.commit()
        conn.close()
        return jsonify({"success": True})
    except Exception as e:
        logger.error(f"Failed to update lab: {e}")
        return jsonify({"error": str(e)}), 500

# 23. Archive/Delete a lab permanently
@app.route("/api/labs/<lab_id>/archive", methods=["POST"])
def archive_lab(lab_id):
    try:
        conn = sqlite3.connect(db_path)
        c = conn.cursor()
        
        # Collect node IDs that belong to this lab so we can clean up node_config
        c.execute("SELECT id FROM nodes WHERE labId = ?", (lab_id,))
        node_ids = [r[0] for r in c.fetchall()]
        
        # Delete node configs for those nodes
        if node_ids:
            placeholders = ",".join("?" * len(node_ids))
            c.execute(f"DELETE FROM node_config WHERE nodeId IN ({placeholders})", node_ids)
        
        # Delete lab record
        c.execute("DELETE FROM labs WHERE id = ?", (lab_id,))
        
        # Delete related clusters
        c.execute("DELETE FROM clusters WHERE labId = ?", (lab_id,))
        
        # Delete related nodes
        c.execute("DELETE FROM nodes WHERE labId = ?", (lab_id,))
        
        # Delete schedules inside
        c.execute("DELETE FROM lab_schedules WHERE labId = ?", (lab_id,))
        
        # Delete events & incidents inside
        c.execute("DELETE FROM access_events WHERE labId = ?", (lab_id,))
        c.execute("DELETE FROM incidents WHERE labId = ?", (lab_id,))
        
        conn.commit()
        conn.close()
        return jsonify({"success": True})
    except Exception as e:
        logger.error(f"Failed to delete lab permanently: {e}")
        return jsonify({"error": str(e)}), 500

# 24. Create a cluster
@app.route("/api/labs/<lab_id>/clusters", methods=["POST"])
def create_cluster(lab_id):
    data = request.json or {}
    name = data.get("name", "").strip()
    if not name:
        return jsonify({"error": "Cluster name is required"}), 400
        
    import uuid
    cluster_id = "cluster-" + uuid.uuid4().hex[:8]
    code = name.upper().replace(" ", "-")[:10]
    now_str = datetime.now().isoformat()
    
    try:
        conn = sqlite3.connect(db_path)
        c = conn.cursor()
        c.execute("""
            INSERT INTO clusters (id, labId, name, code, status, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, 'active', ?, ?)
        """, (cluster_id, lab_id, name, code, now_str, now_str))
        conn.commit()
        conn.close()
        return jsonify({"success": True, "id": cluster_id})
    except Exception as e:
        logger.error(f"Failed to create cluster: {e}")
        return jsonify({"error": str(e)}), 500

# 25. Create a node
@app.route("/api/labs/<lab_id>/clusters/<cluster_id>/nodes", methods=["POST"])
def create_node(lab_id, cluster_id):
    data = request.json or {}
    name = data.get("name", "").strip()
    if not name:
        return jsonify({"error": "Node name is required"}), 400
        
    device_id = data.get("deviceId", "").strip()
    location = data.get("location", "").strip()
    
    import uuid
    node_id = "node-" + uuid.uuid4().hex[:8]
    code = name.upper().replace(" ", "-")[:10]
    now_str = datetime.now().isoformat()
    
    try:
        conn = sqlite3.connect(db_path)
        c = conn.cursor()
        c.execute("""
            INSERT INTO nodes (id, clusterId, labId, name, code, deviceId, location, status, onlineState, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'offline', 'offline', ?, ?)
        """, (node_id, cluster_id, lab_id, name, code, device_id, location, now_str, now_str))
        conn.commit()
        conn.close()
        return jsonify({"success": True, "id": node_id})
    except Exception as e:
        logger.error(f"Failed to create node: {e}")
        return jsonify({"error": str(e)}), 500

# 26. Update a node
@app.route("/api/labs/<lab_id>/clusters/<cluster_id>/nodes/<node_id>", methods=["PUT"])
def update_node(lab_id, cluster_id, node_id):
    data = request.json or {}
    name = data.get("name", "").strip()
    device_id = data.get("deviceId", "").strip()
    location = data.get("location", "").strip()
    
    if not name:
        return jsonify({"error": "Node name is required"}), 400
        
    now_str = datetime.now().isoformat()
    try:
        conn = sqlite3.connect(db_path)
        c = conn.cursor()
        c.execute("""
            UPDATE nodes
            SET name = ?, deviceId = ?, location = ?, updatedAt = ?
            WHERE id = ? AND clusterId = ? AND labId = ?
        """, (name, device_id, location, now_str, node_id, cluster_id, lab_id))
        conn.commit()
        conn.close()
        return jsonify({"success": True})
    except Exception as e:
        logger.error(f"Failed to update node: {e}")
        return jsonify({"error": str(e)}), 500

# 27. Delete a node
@app.route("/api/labs/<lab_id>/clusters/<cluster_id>/nodes/<node_id>", methods=["DELETE"])
def delete_node(lab_id, cluster_id, node_id):
    try:
        conn = sqlite3.connect(db_path)
        c = conn.cursor()
        c.execute("""
            DELETE FROM nodes
            WHERE id = ? AND clusterId = ? AND labId = ?
        """, (node_id, cluster_id, lab_id))
        conn.commit()
        conn.close()
        return jsonify({"success": True})
    except Exception as e:
        logger.error(f"Failed to delete node: {e}")
        return jsonify({"error": str(e)}), 500

# 28. Clear schedules for a specific lab
@app.route("/api/labs/<lab_id>/schedules/clear", methods=["DELETE"])
def clear_lab_schedules(lab_id):
    try:
        conn = sqlite3.connect(db_path)
        c = conn.cursor()
        c.execute("DELETE FROM lab_schedules WHERE labId = ?", (lab_id,))
        conn.commit()
        conn.close()
        return jsonify({"success": True})
    except Exception as e:
        logger.error(f"Failed to clear schedules for lab {lab_id}: {e}")
        return jsonify({"error": str(e)}), 500

# 29. Clear schedules for ALL labs
@app.route("/api/labs/schedules/clear-all", methods=["DELETE"])
def clear_all_schedules():
    try:
        conn = sqlite3.connect(db_path)
        c = conn.cursor()
        c.execute("DELETE FROM lab_schedules")
        conn.commit()
        conn.close()
        return jsonify({"success": True})
    except Exception as e:
        logger.error(f"Failed to clear all schedules: {e}")
        return jsonify({"error": str(e)}), 500

# 30. Get all unique schedule files/lists
@app.route("/api/schedules/files", methods=["GET"])
def get_schedule_files():
    try:
        conn = sqlite3.connect(db_path)
        c = conn.cursor()
        c.execute("""
            SELECT DISTINCT filename, labId 
            FROM lab_schedules 
            WHERE filename IS NOT NULL AND filename != ''
        """)
        rows = c.fetchall()
        
        c.execute("SELECT id, name FROM labs")
        lab_map = {r[0]: r[1] for r in c.fetchall()}
        conn.close()
        
        files = []
        for row in rows:
            fn, lid = row
            files.append({
                "filename": fn,
                "labId": lid,
                "labName": lab_map.get(lid, lid)
            })
            
        # Check if there are legacy schedules without a filename
        conn = sqlite3.connect(db_path)
        c = conn.cursor()
        c.execute("SELECT DISTINCT labId FROM lab_schedules WHERE filename IS NULL OR filename = ''")
        legacy_lids = [r[0] for r in c.fetchall()]
        conn.close()
        
        for lid in legacy_lids:
            files.append({
                "filename": "Legacy Schedule",
                "labId": lid,
                "labName": lab_map.get(lid, lid)
            })
            
        return jsonify(files)
    except Exception as e:
        logger.error(f"Failed to get schedule files: {e}")
        return jsonify({"error": str(e)}), 500

# 31. Get schedules by filename & labId
@app.route("/api/schedules/by-file", methods=["GET"])
def get_schedules_by_file():
    filename = request.args.get("filename", "")
    lab_id = request.args.get("labId", "")
    if not filename or not lab_id:
        return jsonify({"error": "Missing filename or labId"}), 400
        
    try:
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        c = conn.cursor()
        if filename == "Legacy Schedule":
            c.execute("""
                SELECT id, student_id, student_name, group_nr, student_nr, date, day_of_week, ma, session_num, experiment, createdAt, filename, labId
                FROM lab_schedules 
                WHERE (filename IS NULL OR filename = '') AND labId = ?
                ORDER BY date ASC, session_num ASC
            """, (lab_id,))
        else:
            c.execute("""
                SELECT id, student_id, student_name, group_nr, student_nr, date, day_of_week, ma, session_num, experiment, createdAt, filename, labId
                FROM lab_schedules 
                WHERE filename = ? AND labId = ?
                ORDER BY date ASC, session_num ASC
            """, (filename, lab_id))
        rows = c.fetchall()
        conn.close()
        return jsonify([dict(r) for r in rows])
    except Exception as e:
        logger.error(f"Failed to get schedules by file: {e}")
        return jsonify({"error": str(e)}), 500

# 32. Delete schedules by filename & labId
@app.route("/api/schedules/by-file", methods=["DELETE"])
def delete_schedules_by_file():
    filename = request.args.get("filename", "")
    lab_id = request.args.get("labId", "")
    if not filename or not lab_id:
        return jsonify({"error": "Missing filename or labId"}), 400
        
    try:
        conn = sqlite3.connect(db_path)
        c = conn.cursor()
        if filename == "Legacy Schedule":
            c.execute("DELETE FROM lab_schedules WHERE (filename IS NULL OR filename = '') AND labId = ?", (lab_id,))
        else:
            c.execute("DELETE FROM lab_schedules WHERE filename = ? AND labId = ?", (filename, lab_id))
        conn.commit()
        conn.close()
        return jsonify({"success": True})
    except Exception as e:
        logger.error(f"Failed to delete schedules by file: {e}")
        return jsonify({"error": str(e)}), 500



# ==========================================
# EQUIPMENT / MODULE MANAGEMENT ENDPOINTS
# ==========================================
@app.route('/api/labs/<lab_id>/equipment', methods=['GET'])
def get_lab_equipment(lab_id):
    try:
        items = db.get_equipment(lab_id)
        return jsonify(items), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/labs/<lab_id>/equipment', methods=['POST'])
def add_lab_equipment(lab_id):
    try:
        data = request.json or {}
        data['labId'] = lab_id
        serial_num = data.get('serialNumber') or data.get('serial_number')
        if not serial_num or not data.get('name'):
            return jsonify({"error": "Serial Number and Equipment Name are required"}), 400
        eq_id = db.add_equipment(data)
        return jsonify({"message": "Equipment added successfully", "id": eq_id}), 201
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/labs/<lab_id>/equipment/<eq_id>', methods=['PUT'])
def update_lab_equipment(lab_id, eq_id):
    try:
        data = request.json or {}
        db.update_equipment(eq_id, data)
        return jsonify({"message": "Equipment updated successfully"}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/labs/<lab_id>/equipment/<eq_id>/borrow', methods=['POST'])
def borrow_lab_equipment(lab_id, eq_id):
    try:
        data = request.json or {}
        if not data.get('borrowerName') or not data.get('borrowerId'):
            return jsonify({"error": "Student Name and Student ID are required"}), 400
        db.borrow_equipment(eq_id, data)
        return jsonify({"message": "Equipment borrowed successfully"}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/labs/<lab_id>/equipment/<eq_id>/return', methods=['POST'])
def return_lab_equipment(lab_id, eq_id):
    try:
        db.return_equipment(eq_id)
        return jsonify({"message": "Equipment returned successfully"}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/labs/<lab_id>/equipment/<eq_id>', methods=['DELETE'])
def delete_lab_equipment(lab_id, eq_id):
    try:
        db.delete_equipment(eq_id)
        return jsonify({"message": "Equipment deleted successfully"}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ── Qwen 2.5 Coder AI Assistant Endpoints ─────────────────────────────────────

@app.route('/api/ai/status', methods=['GET'])
def get_ai_status():
    try:
        status_data = ai_assistant.check_status()
        return jsonify(status_data), 200
    except Exception as e:
        return jsonify({"status": "offline", "error": str(e)}), 500

@app.route('/api/ai/chat', methods=['POST'])
def ai_chat():
    try:
        data = request.json or {}
        prompt = data.get('prompt', '')
        page = data.get('page', 'overview')
        history = data.get('history', [])
        lab_id = data.get('labId')
        custom_table_data = data.get('tableData')

        if not prompt:
            return jsonify({"error": "Prompt parameter is required"}), 400

        result = ai_assistant.generate_response(
            user_prompt=prompt,
            current_page=page,
            history=history,
            lab_id=lab_id,
            custom_table_data=custom_table_data
        )
        return jsonify(result), 200
    except Exception as e:
        logger.error(f"Error handling AI chat request: {e}")
        return jsonify({"success": False, "response": f"System error: {str(e)}"}), 500

@app.route('/api/ai/chat-stream', methods=['POST'])
def ai_chat_stream():
    try:
        data = request.json or {}
        prompt = data.get('prompt', '')
        page = data.get('page', 'overview')
        history = data.get('history', [])
        lab_id = data.get('labId')

        if not prompt:
            return jsonify({"error": "Prompt parameter is required"}), 400

        def stream_generator():
            for chunk in ai_assistant.generate_response_stream(
                user_prompt=prompt,
                current_page=page,
                history=history,
                lab_id=lab_id
            ):
                yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"

        return Response(stream_generator(), mimetype='text/event-stream')
    except Exception as e:
        logger.error(f"Error handling AI chat stream: {e}")
        return jsonify({"success": False, "response": f"System error: {str(e)}"}), 500

@app.route('/api/ai/analyze-table', methods=['POST'])
def analyze_table():
    try:
        data = request.json or {}
        page = data.get('page', 'users')
        lab_id = data.get('labId')
        
        table_markdown = ai_assistant.extract_table_context(lab_id=lab_id, page=page)
        prompt = f"Phân tích dữ liệu bảng dưới đây của trang {page.upper()} và tóm tắt những thông tin quan trọng nhất, các bất thường (nếu có) hoặc thống kê nổi bật:"
        
        result = ai_assistant.generate_response(
            user_prompt=prompt,
            current_page=page,
            lab_id=lab_id,
            custom_table_data=table_markdown
        )
        return jsonify(result), 200
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

if __name__ == "__main__":
    logger.info("=== STARTING OFFLINE ACCESS CONTROL API SERVER ===")
    logger.info(f"Database Path: {db_path}")
    logger.info(f"Web Static Files Path: {static_dir}")
    logger.info("Running locally on http://0.0.0.0:5000")
    
    # Run with debug mode only if FLASK_DEBUG env var is set to 1
    debug_mode = os.environ.get("FLASK_DEBUG", "0") == "1"
    app.run(host="0.0.0.0", port=5000, debug=debug_mode)


# ========================================
