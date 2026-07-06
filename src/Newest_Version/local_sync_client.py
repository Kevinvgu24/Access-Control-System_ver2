import os
import sys
import time
import shutil
import urllib.request
import urllib.error
import json
import sqlite3
import numpy as np

# Resolve project paths
current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.append(current_dir)

from database import FaceDatabase

# Load configuration from environment variables
SERVER_URL = os.environ.get("SERVER_URL", "http://localhost:5000").rstrip('/')
LAB_ID = os.environ.get("LAB_ID", "default-lab")
NODE_ID = os.environ.get("NODE_ID", "default-node")
DB_PATH = os.environ.get("DB_PATH", os.path.abspath(os.path.join(current_dir, "..", "..", "database", "smart_door.db")))
DB_DIR = os.path.dirname(DB_PATH)

# Initialize database connection
db = FaceDatabase(DB_PATH)

print(f"\n=========================================================")
# Vietnamese: KHỞI ĐỘNG TIẾN TRÌNH ĐỒNG BỘ EDGE NODE -> SERVER TRUNG TÂM
print("   STARTING EDGE NODE -> CENTRAL SERVER SYNC CLIENT   ")
print(f"Server URL:   {SERVER_URL}")
print(f"Lab ID:       {LAB_ID}")
print(f"Node ID:      {NODE_ID}")
print(f"Database:     {DB_PATH}")
print("=========================================================\n")

def make_request(url, method="GET", data=None):
    """Helper to perform HTTP requests with JSON body support."""
    try:
        req = urllib.request.Request(url, method=method)
        req.add_header('User-Agent', 'Mozilla/5.0')
        
        if data is not None:
            req.add_header('Content-Type', 'application/json')
            json_data = json.dumps(data).encode('utf-8')
            req.data = json_data
            
        with urllib.request.urlopen(req, timeout=5) as response:
            return json.loads(response.read().decode('utf-8'))
    except urllib.error.URLError as e:
        # Server is likely unreachable/offline
        raise ConnectionError(f"Server unreachable at {url}: {e.reason}")
    except Exception as e:
        raise ValueError(f"Request failed: {e}")

def download_file(url, save_path):
    """Downloads a raw photo from the central server."""
    try:
        opener = urllib.request.build_opener()
        opener.addheaders = [('User-agent', 'Mozilla/5.0')]
        urllib.request.install_opener(opener)
        urllib.request.urlretrieve(url, save_path)
        return True
    except Exception as e:
        print(f"  [-] Failed to download file from {url}: {e}")
        return False

def sync_users():
    """Sync users from central server to local SQLite and download photos."""
    try:
        server_users = make_request(f"{SERVER_URL}/api/labs/{LAB_ID}/users")
    except Exception as e:
        print(f"[*] [USER SYNC] Server connection issue: {e}")
        return

    # Keep track of active server users
    active_server_names = set()
    
    # Load users currently stored in local SQLite
    conn = sqlite3.connect(DB_PATH, detect_types=sqlite3.PARSE_DECLTYPES)
    c = conn.cursor()
    c.execute("SELECT name, status, university_id, email, role, pin, embedding FROM users")
    local_users = {}
    for row in c.fetchall():
        local_users[row[0]] = {
            "status": row[1],
            "university_id": row[2],
            "email": row[3],
            "role": row[4],
            "pin": row[5],
            "embedding": row[6]
        }
    conn.close()

    for user in server_users:
        name = user["fullName"]
        university_id = user["university_id"]
        email = user["email"]
        role = user["roles"][0] if user.get("roles") else "student"
        status = user["status"]
        pin = user.get("pin", "")
        
        if status != "active":
            continue
            
        active_server_names.add(name)
        user_dir = os.path.join(DB_DIR, name)
        
        # Scenario A: User is completely new to this edge node
        if name not in local_users:
            print(f"[+] [USER SYNC] New user detected: '{name}'. Syncing profile...")
            os.makedirs(user_dir, exist_ok=True)
            
            # Check if embedding already exists on server
            try:
                emb_res = make_request(f"{SERVER_URL}/api/users/{name}/embedding")
                emb = np.array(emb_res["embedding"], dtype=np.float32)
                db.save_full_user(name, university_id, email, "", role, status, pin, emb)
                print(f"  [+] Downloaded and saved pre-computed embedding from server for '{name}'.")
            except Exception:
                # Embedding not computed on server yet - download raw photos
                # The local AutoSyncManager will run NPU inference on these photos and upload the embedding
                try:
                    photos = make_request(f"{SERVER_URL}/api/users/{name}/photos")
                    for photo in photos:
                        save_path = os.path.join(user_dir, photo)
                        if not os.path.exists(save_path):
                            print(f"  -> Downloading biometric photo: {photo}...")
                            download_file(f"{SERVER_URL}/api/users/{name}/photos/{photo}", save_path)
                            
                    db.save_full_user(name, university_id, email, "", role, status, pin, None)
                    print(f"  [+] Profile and face photos downloaded for '{name}'. Queued for NPU extraction.")
                except Exception as ex:
                    print(f"  [-] Failed to fetch photos list for '{name}': {ex}")
                    
        # Scenario B: User exists locally but fields (PIN, status, role) might be updated
        else:
            # Check if fields have actually changed before calling database update
            conn = sqlite3.connect(DB_PATH, detect_types=sqlite3.PARSE_DECLTYPES)
            c = conn.cursor()
            c.execute("SELECT university_id, email, role, status, pin, embedding FROM users WHERE name = ?", (name,))
            local_row = c.fetchone()
            conn.close()
            
            local_emb = None
            needs_db_write = True
            
            if local_row:
                local_uni_id = local_row[0]
                local_email = local_row[1]
                local_role = local_row[2]
                local_status = local_row[3]
                local_pin = local_row[4]
                local_emb = local_row[5]
                
                if (local_uni_id == university_id and 
                    local_email == email and 
                    local_role == role and 
                    local_status == status and 
                    local_pin == pin):
                    needs_db_write = False
            
            if local_emb is not None:
                # Local embedding exists. Let's upload it to the server if the server's faceStatus is incomplete
                if user.get("faceStatus") != "complete":
                    print(f"[*] [EMBEDDING SYNC] Server is missing embedding for '{name}'. Uploading...")
                    try:
                        emb_list = local_emb.tolist()
                        make_request(f"{SERVER_URL}/api/users/{name}/embedding", method="POST", data={"embedding": emb_list})
                        print(f"  [+] Uploaded embedding for '{name}' successfully.")
                    except Exception as e:
                        print(f"  [-] Failed to upload embedding for '{name}': {e}")
                        
            if needs_db_write:
                # Sync user fields to SQLite
                db.save_full_user(name, university_id, email, "", role, status, pin, local_emb)

    # Clean up local users that are no longer active on the central server
    for local_name in list(local_users.keys()):
        if local_name not in active_server_names:
            print(f"[-] [USER SYNC] User '{local_name}' is revoked/removed from central server. Purging local cache...")
            db.delete_user(local_name)
            local_dir = os.path.join(DB_DIR, local_name)
            if os.path.exists(local_dir):
                shutil.rmtree(local_dir)

def sync_logs():
    """Upload unsynced access logs and incidents from local SQLite to Server."""
    # 1. Sync access events
    unsynced_events = db.get_unsynced_access_events()
    if unsynced_events:
        print(f"[*] [LOG SYNC] Pushing {len(unsynced_events)} unsynced access events to server...")
        try:
            res = make_request(f"{SERVER_URL}/api/labs/{LAB_ID}/access-events", method="POST", data=unsynced_events)
            if res.get("success"):
                ids = [ev["id"] for ev in unsynced_events]
                db.mark_access_events_synced(ids)
                print(f"  [+] Access events synced successfully.")
        except Exception as e:
            print(f"  [-] Failed to sync access events: {e}")

    # 2. Sync incidents
    unsynced_incidents = db.get_unsynced_incidents()
    if unsynced_incidents:
        print(f"[*] [LOG SYNC] Pushing {len(unsynced_incidents)} unsynced incidents to server...")
        try:
            res = make_request(f"{SERVER_URL}/api/labs/{LAB_ID}/incidents", method="POST", data=unsynced_incidents)
            if res.get("success"):
                ids = [inc["id"] for inc in unsynced_incidents]
                db.mark_incidents_synced(ids)
                print(f"  [+] Incidents synced successfully.")
        except Exception as e:
            print(f"  [-] Failed to sync incidents: {e}")

def sync_telemetry():
    """Push local telemetry status to central server."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute("SELECT latestTelemetry, status, onlineState FROM nodes WHERE id = ?", (NODE_ID,))
    row = c.fetchone()
    conn.close()

    if not row:
        print(f"[*] [TELEMETRY] Node '{NODE_ID}' not found in local database!")
        return

    telemetry_str = row["latestTelemetry"]
    if not telemetry_str:
        print(f"[*] [TELEMETRY] No telemetry data in local database yet.")
        return

    try:
        telemetry = json.loads(telemetry_str)
        payload = {
            "status": row["status"],
            "onlineState": row["onlineState"],
            "cameraFps": telemetry.get("cameraFps", 0.0),
            "cpuPercent": telemetry.get("cpuPercent", 0.0),
            "ramPercent": telemetry.get("ramPercent", 0.0),
            "temperatureC": telemetry.get("temperatureC", 0.0)
        }
        
        make_request(f"{SERVER_URL}/api/labs/{LAB_ID}/nodes/{NODE_ID}/telemetry", method="POST", data=payload)
        print(f"[*] [TELEMETRY] Telemetry pushed successfully to server (IP: {SERVER_URL})")
    except Exception as e:
        print(f"[-] [TELEMETRY] Failed to push telemetry: {e}")

def sync_config():
    """Pull central configuration and apply to local SQLite."""
    try:
        server_config = make_request(f"{SERVER_URL}/api/labs/{LAB_ID}/nodes/{NODE_ID}/config")
        
        # Load local configuration
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute("SELECT version FROM node_config WHERE nodeId = ?", (NODE_ID,))
        row = c.fetchone()
        local_version = row[0] if row else 0
        
        server_version = server_config.get("version", 1)
        if server_version > local_version:
            print(f"[*] [CONFIG SYNC] Local config version ({local_version}) is outdated. Applying server version ({server_version})...")
            
            face_req = 1 if server_config.get("faceRequired", True) else 0
            pin_req = 1 if server_config.get("pinRequired", True) else 0
            pin_fallback = 1 if server_config.get("pinFallbackEnabled", True) else 0
            
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
            """, (
                NODE_ID, 
                server_config.get("confidenceThreshold", 90),
                server_config.get("livenessThreshold", 78),
                pin_fallback,
                face_req,
                pin_req,
                server_version,
                server_config.get("updatedAt", ""),
                server_config.get("updatedBy", "server")
            ))
            conn.commit()
            print("  [+] Config version updated successfully.")
            
        conn.close()
    except Exception as e:
        # Configuration pull fails silently if server is down, fallback to existing local config
        pass

def main():
    while True:
        try:
            sync_users()
            sync_logs()
            sync_config()
            sync_telemetry()
        except Exception as e:
            print(f"[-] [SYNC CLIENT] Error in main sync loop: {e}")
            
        # Yield/Wait 4 seconds before next sync iteration
        time.sleep(4)

if __name__ == "__main__":
    main()
