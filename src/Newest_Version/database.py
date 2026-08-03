import sqlite3
import numpy as np
import io
from logger import get_logger

logger = get_logger("database")

# 1. Thủ thuật chuyển Numpy Array thành Nhị phân để lưu vào SQLite
def adapt_array(arr):
    out = io.BytesIO()
    np.save(out, arr)
    out.seek(0)
    return sqlite3.Binary(out.read())

def convert_array(text):
    out = io.BytesIO(text)
    out.seek(0)
    return np.load(out)

sqlite3.register_adapter(np.ndarray, adapt_array)
sqlite3.register_converter("array", convert_array)

# 2. Các hàm tương tác với Database
class FaceDatabase:
    def __init__(self, db_path="smart_door.db"):
        self.db_path = db_path
        self._init_db()

    def _init_db(self):
        conn = sqlite3.connect(self.db_path, detect_types=sqlite3.PARSE_DECLTYPES)
        c = conn.cursor()
        c.execute("PRAGMA journal_mode=WAL;")
        
        # 1. Tạo bảng users mở rộng
        c.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                labId TEXT,
                name TEXT,
                university_id TEXT,
                email TEXT,
                password TEXT,
                role TEXT DEFAULT 'student',
                status TEXT DEFAULT 'active',
                faceStatus TEXT DEFAULT 'complete',
                pinStatus TEXT DEFAULT 'set',
                pin TEXT,
                embedding array,
                createdAt TEXT,
                updatedAt TEXT,
                UNIQUE(labId, name),
                UNIQUE(labId, university_id),
                UNIQUE(labId, email)
            )
        ''')

        # Thêm các cột nếu chưa có (trong trường hợp DB cũ đã tồn tại)
        columns_to_add = [
            ("labId", "TEXT DEFAULT 'lab_1'"),
            ("university_id", "TEXT"),
            ("email", "TEXT"),
            ("password", "TEXT"),
            ("role", "TEXT DEFAULT 'student'"),
            ("status", "TEXT DEFAULT 'active'"),
            ("faceStatus", "TEXT DEFAULT 'complete'"),
            ("pinStatus", "TEXT DEFAULT 'set'"),
            ("pin", "TEXT"),
            ("createdAt", "TEXT"),
            ("updatedAt", "TEXT")
        ]
        for col_name, col_type in columns_to_add:
            try:
                c.execute(f"ALTER TABLE users ADD COLUMN {col_name} {col_type}")
            except sqlite3.OperationalError:
                pass # Cột đã tồn tại

        # 2. Tạo các bảng khác phục vụ Dashboard
        c.execute('''
            CREATE TABLE IF NOT EXISTS labs (
                id TEXT PRIMARY KEY,
                name TEXT,
                code TEXT,
                location TEXT,
                timezone TEXT,
                manager TEXT,
                activationCode TEXT,
                nodeActivatedAt TEXT,
                nodeActivatedBy TEXT,
                status TEXT DEFAULT 'active',
                createdAt TEXT,
                updatedAt TEXT
            )
        ''')
        for col in ["activationCode", "nodeActivatedAt", "nodeActivatedBy"]:
            try:
                c.execute(f"ALTER TABLE labs ADD COLUMN {col} TEXT")
            except sqlite3.OperationalError:
                pass
        
        c.execute('''
            CREATE TABLE IF NOT EXISTS clusters (
                id TEXT PRIMARY KEY,
                labId TEXT,
                name TEXT,
                code TEXT,
                status TEXT DEFAULT 'active',
                createdAt TEXT,
                updatedAt TEXT
            )
        ''')

        c.execute('''
            CREATE TABLE IF NOT EXISTS nodes (
                id TEXT PRIMARY KEY,
                clusterId TEXT,
                labId TEXT,
                name TEXT,
                code TEXT,
                deviceId TEXT,
                location TEXT,
                status TEXT DEFAULT 'offline',
                onlineState TEXT DEFAULT 'offline',
                currentConfigVersion INTEGER DEFAULT 1,
                currentManifestVersion INTEGER DEFAULT 1,
                lastHeartbeatAt TEXT,
                latestTelemetry TEXT,
                createdAt TEXT,
                updatedAt TEXT
            )
        ''')

        c.execute('''
            CREATE TABLE IF NOT EXISTS node_config (
                nodeId TEXT PRIMARY KEY,
                confidenceThreshold INTEGER DEFAULT 90,
                livenessThreshold INTEGER DEFAULT 78,
                pinFallbackEnabled INTEGER DEFAULT 1,
                faceRequired INTEGER DEFAULT 1,
                pinRequired INTEGER DEFAULT 1,
                version INTEGER DEFAULT 1,
                updatedAt TEXT,
                updatedBy TEXT
            )
        ''')

        c.execute('''
            CREATE TABLE IF NOT EXISTS access_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                labId TEXT,
                clusterId TEXT,
                nodeId TEXT,
                occurredAt TEXT,
                receivedAt TEXT,
                userId TEXT,
                universityId TEXT,
                displayName TEXT,
                method TEXT,
                result TEXT,
                reason TEXT,
                confidence REAL,
                livenessScore REAL,
                pinFallbackUsed INTEGER,
                synced INTEGER DEFAULT 0
            )
        ''')

        c.execute('''
            CREATE TABLE IF NOT EXISTS incidents (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                labId TEXT,
                clusterId TEXT,
                nodeId TEXT,
                type TEXT,
                severity TEXT,
                status TEXT DEFAULT 'open',
                summary TEXT,
                createdAt TEXT,
                synced INTEGER DEFAULT 0
            )
        ''')

        c.execute('''
            CREATE TABLE IF NOT EXISTS admins (
                id TEXT PRIMARY KEY,
                email TEXT UNIQUE,
                password TEXT,
                displayName TEXT,
                type TEXT DEFAULT 'super_admin',
                status TEXT DEFAULT 'active',
                createdAt TEXT
            )
        ''')

        c.execute('''
            CREATE TABLE IF NOT EXISTS lab_schedules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                labId TEXT,
                student_id TEXT,
                student_name TEXT,
                group_nr TEXT,
                student_nr TEXT,
                date TEXT,
                day_of_week TEXT,
                ma TEXT,
                session_num TEXT,
                experiment TEXT,
                createdAt TEXT,
                filename TEXT
            )
        ''')

        c.execute('''
            CREATE TABLE IF NOT EXISTS environment_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                labId TEXT,
                temperature REAL,
                humidity REAL,
                latitude REAL,
                longitude REAL,
                altitude REAL,
                speed REAL,
                satellites INTEGER,
                dht_ok INTEGER DEFAULT 1,
                gnss_ok INTEGER DEFAULT 1,
                raw_payload TEXT,
                receivedAt TEXT
            )
        ''')

        c.execute('''
            CREATE TABLE IF NOT EXISTS subnodes (
                id TEXT PRIMARY KEY,
                labId TEXT,
                name TEXT,
                sensors TEXT,
                maintenance_mode INTEGER DEFAULT 0,
                createdAt TEXT
            )
        ''')

        c.execute('''
            CREATE TABLE IF NOT EXISTS node_telemetry_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                node_id TEXT,
                labId TEXT,
                temperature REAL,
                humidity REAL,
                pm25 REAL,
                co2 REAL,
                light REAL,
                latitude REAL,
                longitude REAL,
                altitude REAL,
                speed REAL,
                satellites INTEGER,
                sensor_ok INTEGER DEFAULT 1,
                raw_payload TEXT,
                receivedAt TEXT
            )
        ''')

        # Add maintenance_mode column to subnodes if it doesn't exist
        try:
            c.execute("ALTER TABLE subnodes ADD COLUMN maintenance_mode INTEGER DEFAULT 0")
        except sqlite3.OperationalError:
            pass
            
        # Migrate existing databases to Multi-Lab schema by adding labId column with default 'lab_1'
        for table_name in ["environment_telemetry", "subnodes", "node_telemetry_history"]:
            try:
                c.execute(f"ALTER TABLE {table_name} ADD COLUMN labId TEXT DEFAULT 'lab_1'")
            except sqlite3.OperationalError:
                pass

        # Add synced column to access_events and incidents if they don't exist in existing database
        for col_name, table_name in [("synced", "access_events"), ("synced", "incidents")]:
            try:
                c.execute(f"ALTER TABLE {table_name} ADD COLUMN {col_name} INTEGER DEFAULT 0")
            except sqlite3.OperationalError:
                pass

        # Add manager column to labs if it doesn't exist in existing database
        try:
            c.execute("ALTER TABLE labs ADD COLUMN manager TEXT")
        except sqlite3.OperationalError:
            pass

        # Add filename column to lab_schedules if it doesn't exist in existing database
        try:
            c.execute("ALTER TABLE lab_schedules ADD COLUMN filename TEXT")
        except sqlite3.OperationalError:
            pass

        # Migrate old 'faculty' roles to 'lecturer' (case-insensitive)
        try:
            c.execute("UPDATE users SET role = 'lecturer' WHERE LOWER(role) = 'faculty'")
        except sqlite3.OperationalError:
            pass

        conn.commit()

        # Bootstrap dữ liệu mặc định nếu các bảng trống
        now_str = datetime.now().isoformat() if 'datetime' in globals() else "2026-06-25T08:00:00"
        import datetime as dt
        now_str = dt.datetime.now().isoformat()

        # Lab mặc định
        c.execute("SELECT COUNT(*) FROM labs")
        if c.fetchone()[0] == 0:
            c.execute("INSERT INTO labs (id, name, code, location, timezone, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
                      ("default-lab", "ECE Demo Lab", "ECE-DEMO", "Building C, Room 205", "Asia/Ho_Chi_Minh", now_str, now_str))

        # Cluster mặc định
        c.execute("SELECT COUNT(*) FROM clusters")
        if c.fetchone()[0] == 0:
            c.execute("INSERT INTO clusters (id, labId, name, code, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)",
                      ("default-cluster", "default-lab", "Main Cluster", "MAIN", now_str, now_str))

        # Node mặc định
        c.execute("SELECT COUNT(*) FROM nodes")
        if c.fetchone()[0] == 0:
            c.execute("INSERT INTO nodes (id, clusterId, labId, name, code, deviceId, location, status, onlineState, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                      ("default-node", "default-cluster", "default-lab", "Door A — Main Entrance", "DOOR-A", "B8:27:EB:3A:5C:11", "Main Entrance", "online", "online", now_str, now_str))

        # Node config mặc định
        c.execute("SELECT COUNT(*) FROM node_config")
        if c.fetchone()[0] == 0:
            c.execute("INSERT INTO node_config (nodeId, confidenceThreshold, livenessThreshold, pinFallbackEnabled, faceRequired, pinRequired, version, updatedAt, updatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                      ("default-node", 90, 78, 1, 1, 1, 1, now_str, "system"))

        # Admin mặc định (Email: dawnnkevin9@gmail.com, Pass: admin123)
        c.execute("SELECT COUNT(*) FROM admins")
        if c.fetchone()[0] == 0:
            try:
                from werkzeug.security import generate_password_hash
                pw_hash = generate_password_hash("admin123")
            except ImportError:
                import hashlib
                pw_hash = hashlib.sha256("admin123".encode()).hexdigest()
            c.execute("INSERT INTO admins (id, email, password, displayName, type, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
                      ("default-admin", "dawnnkevin9@gmail.com", pw_hash, "Kevin", "super_admin", "active", now_str))

        conn.commit()
        conn.close()

    def save_user(self, lab_id, name, embedding):
        conn = sqlite3.connect(self.db_path, detect_types=sqlite3.PARSE_DECLTYPES)
        c = conn.cursor()
        try:
            # Kiểm tra xem user đã tồn tại chưa để tránh ghi đè các cột thông tin cá nhân
            c.execute("SELECT id FROM users WHERE name = ? AND labId = ?", (name, lab_id))
            row = c.fetchone()
            if row:
                c.execute("UPDATE users SET embedding = ?, faceStatus = 'complete' WHERE name = ? AND labId = ?", (embedding, name, lab_id))
            else:
                import datetime as dt
                now_str = dt.datetime.now().isoformat()
                c.execute("INSERT INTO users (labId, name, embedding, status, faceStatus, createdAt, updatedAt) VALUES (?, ?, ?, 'active', 'complete', ?, ?)", 
                          (lab_id, name, embedding, now_str, now_str))
            conn.commit()
            logger.info(f"Saved/Updated profile: {name}")
        except Exception as e:
            logger.error(f"Error saving {name}: {e}")
        finally:
            conn.close()

    def delete_user(self, lab_id, name):
        conn = sqlite3.connect(self.db_path, detect_types=sqlite3.PARSE_DECLTYPES)
        c = conn.cursor()
        try:
            c.execute("DELETE FROM users WHERE name = ? AND labId = ?", (name, lab_id))
            conn.commit()
            logger.info(f"Permanently deleted profile: {name}")
        except Exception as e:
            logger.error(f"Error deleting {name}: {e}")
        finally:
            conn.close()

    def load_all_users(self):
        conn = sqlite3.connect(self.db_path, detect_types=sqlite3.PARSE_DECLTYPES)
        c = conn.cursor()
        c.execute("SELECT name, embedding FROM users WHERE embedding IS NOT NULL")
        rows = c.fetchall()
        conn.close()
        return {row[0]: row[1] for row in rows}

    def save_full_user(self, lab_id, name, university_id, email, password, role, status, pin, embedding=None):
        conn = sqlite3.connect(self.db_path, detect_types=sqlite3.PARSE_DECLTYPES)
        c = conn.cursor()
        try:
            import datetime as dt
            now_str = dt.datetime.now().isoformat()
            
            c.execute("SELECT id FROM users WHERE (name = ? OR email = ?) AND labId = ?", (name, email, lab_id))
            row = c.fetchone()
            if row:
                if embedding is not None:
                    c.execute("""
                        UPDATE users SET 
                            university_id = ?, email = ?, password = ?, role = ?, status = ?, pin = ?, embedding = ?, updatedAt = ?, faceStatus = 'complete'
                        WHERE id = ?
                    """, (university_id, email, password, role, status, pin, embedding, now_str, row[0]))
                else:
                    c.execute("""
                        UPDATE users SET 
                            university_id = ?, email = ?, password = ?, role = ?, status = ?, pin = ?, updatedAt = ?
                        WHERE id = ?
                    """, (university_id, email, password, role, status, pin, now_str, row[0]))
            else:
                c.execute("""
                    INSERT INTO users 
                        (labId, name, university_id, email, password, role, status, pin, embedding, faceStatus, pinStatus, createdAt, updatedAt)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (lab_id, name, university_id, email, password, role, status, pin, embedding, 
                      'complete' if embedding is not None else 'incomplete',
                      'set' if pin else 'missing', now_str, now_str))
            conn.commit()
            logger.info(f"Saved full user profile: {name} ({email}) in lab {lab_id}")
        except Exception as e:
            logger.error(f"Error saving full user {name}: {e}")
        finally:
            conn.close()

    def log_access_event(self, labId, clusterId, nodeId, userId, universityId, displayName, method, result, reason, confidence, livenessScore, pinFallbackUsed):
        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()
        try:
            import datetime as dt
            now_str = dt.datetime.now().isoformat()
            c.execute("""
                INSERT INTO access_events 
                    (labId, clusterId, nodeId, occurredAt, receivedAt, userId, universityId, displayName, method, result, reason, confidence, livenessScore, pinFallbackUsed)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (labId, clusterId, nodeId, now_str, now_str, userId, universityId, displayName, method, result, reason, confidence, livenessScore, pinFallbackUsed))
            conn.commit()
        except Exception as e:
            logger.error(f"Error logging access event: {e}")
        finally:
            conn.close()

    def log_incident(self, labId, clusterId, nodeId, type_, severity, summary):
        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()
        try:
            import datetime as dt
            now_str = dt.datetime.now().isoformat()
            c.execute("""
                INSERT INTO incidents 
                    (labId, clusterId, nodeId, type, severity, status, summary, createdAt)
                VALUES (?, ?, ?, ?, ?, 'open', ?, ?)
            """, (labId, clusterId, nodeId, type_, severity, summary, now_str))
            conn.commit()
        except Exception as e:
            logger.error(f"Error logging incident: {e}")
        finally:
            conn.close()

    def update_node_telemetry(self, nodeId, status, onlineState, cameraFps, cpuPercent, ramPercent, temperatureC, labId=None):
        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()
        try:
            import datetime as dt
            import json
            now_str = dt.datetime.now().isoformat()
            
            telemetry_data = {
                "heartbeatAt": now_str,
                "onlineState": onlineState,
                "modelStatus": "running" if status == "online" else "stopped",
                "cpuPercent": cpuPercent,
                "ramPercent": ramPercent,
                "cameraFps": cameraFps,
                "temperatureC": temperatureC,
                "updatedAt": now_str
            }
            telemetry_json = json.dumps(telemetry_data)

            # Check if node exists
            c.execute("SELECT id FROM nodes WHERE id = ?", (nodeId,))
            row = c.fetchone()
            if not row:
                # If node does not exist, insert it under the cluster of the given lab
                c.execute("SELECT id FROM clusters WHERE labId = ?", (labId or "default-lab",))
                cluster_row = c.fetchone()
                cluster_id = cluster_row[0] if cluster_row else "default-cluster"
                
                c.execute("""
                    INSERT INTO nodes (id, clusterId, labId, name, code, status, onlineState, lastHeartbeatAt, latestTelemetry, createdAt, updatedAt)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    nodeId,
                    cluster_id,
                    labId or "default-lab",
                    f"Node {nodeId}",
                    nodeId.upper(),
                    status,
                    onlineState,
                    now_str,
                    telemetry_json,
                    now_str,
                    now_str
                ))
            else:
                # Update nodes table with latest state
                c.execute("""
                    UPDATE nodes SET 
                        status = ?, onlineState = ?, lastHeartbeatAt = ?, latestTelemetry = ?, updatedAt = ?
                    WHERE id = ?
                """, (status, onlineState, now_str, telemetry_json, now_str, nodeId))
            conn.commit()
        except Exception as e:
            logger.error(f"Error updating node telemetry: {e}")
        finally:
            conn.close()

    def get_unsynced_access_events(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        c = conn.cursor()
        try:
            c.execute("SELECT * FROM access_events WHERE synced = 0")
            rows = c.fetchall()
            return [dict(row) for row in rows]
        except Exception as e:
            logger.error(f"Error getting unsynced events: {e}")
            return []
        finally:
            conn.close()

    def mark_access_events_synced(self, ids):
        if not ids:
            return
        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()
        try:
            placeholders = ",".join("?" for _ in ids)
            c.execute(f"UPDATE access_events SET synced = 1 WHERE id IN ({placeholders})", ids)
            conn.commit()
        except Exception as e:
            logger.error(f"Error marking events synced: {e}")
        finally:
            conn.close()

    def get_unsynced_incidents(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        c = conn.cursor()
        try:
            c.execute("SELECT * FROM incidents WHERE synced = 0")
            rows = c.fetchall()
            return [dict(row) for row in rows]
        except Exception as e:
            logger.error(f"Error getting unsynced incidents: {e}")
            return []
        finally:
            conn.close()

    def mark_incidents_synced(self, ids):
        if not ids:
            return
        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()
        try:
            placeholders = ",".join("?" for _ in ids)
            c.execute(f"UPDATE incidents SET synced = 1 WHERE id IN ({placeholders})", ids)
            conn.commit()
        except Exception as e:
            logger.error(f"Error marking incidents synced: {e}")
        finally:
            conn.close()

    def save_sensor_telemetry(self, lab_id, temperature, humidity, latitude, longitude, altitude, speed, satellites, dht_ok=True, gnss_ok=True, raw_payload=""):
        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()
        try:
            import datetime as dt
            now_str = dt.datetime.now().isoformat()
            c.execute("""
                INSERT INTO environment_telemetry 
                    (labId, temperature, humidity, latitude, longitude, altitude, speed, satellites, dht_ok, gnss_ok, raw_payload, receivedAt)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                lab_id, temperature, humidity, latitude, longitude, altitude, speed, satellites,
                1 if dht_ok else 0, 1 if gnss_ok else 0, str(raw_payload), now_str
            ))
            conn.commit()
        except Exception as e:
            logger.error(f"Error saving sensor telemetry: {e}")
        finally:
            conn.close()

    def get_latest_sensor_telemetry(self, lab_id):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        c = conn.cursor()
        try:
            c.execute("SELECT * FROM environment_telemetry WHERE labId = ? ORDER BY id DESC LIMIT 1", (lab_id,))
            row = c.fetchone()
            if row:
                res = dict(row)
                res["dht_ok"] = bool(res["dht_ok"])
                res["gnss_ok"] = bool(res["gnss_ok"])
                return res
            return None
        except Exception as e:
            logger.error(f"Error reading latest sensor telemetry: {e}")
            return None
        finally:
            conn.close()

    def save_subnode(self, lab_id, node_id, name, sensors, maintenance_mode=0):
        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()
        try:
            import datetime as dt
            now_str = dt.datetime.now().isoformat()
            c.execute("""
                INSERT INTO subnodes (id, labId, name, sensors, maintenance_mode, createdAt)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    labId=excluded.labId,
                    name=excluded.name,
                    sensors=excluded.sensors,
                    maintenance_mode=excluded.maintenance_mode
            """, (node_id, lab_id, name, sensors, maintenance_mode, now_str))
            conn.commit()
        except Exception as e:
            logger.error(f"Error saving subnode: {e}")
        finally:
            conn.close()

    def get_all_subnodes(self, lab_id):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        c = conn.cursor()
        try:
            c.execute("SELECT * FROM subnodes WHERE LOWER(labId) = LOWER(?) OR labId = 'default-lab'", (lab_id,))
            rows = c.fetchall()
            return {row["id"]: dict(row) for row in rows}
        except Exception as e:
            logger.error(f"Error reading subnodes: {e}")
            return {}
        finally:
            conn.close()

    def get_all_subnodes_globally(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        c = conn.cursor()
        try:
            c.execute("SELECT * FROM subnodes")
            rows = c.fetchall()
            return [dict(r) for r in rows]
        except Exception as e:
            logger.error(f"Error reading all subnodes globally: {e}")
            return []
        finally:
            conn.close()

    def delete_subnode(self, lab_id, node_id):
        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()
        try:
            c.execute("DELETE FROM subnodes WHERE id = ? OR (id = ? AND labId = ?)", (node_id, node_id, lab_id))
            conn.commit()
        except Exception as e:
            logger.error(f"Error deleting subnode: {e}")
        finally:
            conn.close()

    def get_subnode_globally(self, node_id):
        if not node_id:
            return None
        node_id_clean = str(node_id).strip()
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        c = conn.cursor()
        try:
            c.execute("SELECT * FROM subnodes WHERE LOWER(id) = LOWER(?) OR LOWER(id) = LOWER(?) OR LOWER(id) = LOWER(?)", 
                      (node_id_clean, node_id_clean.replace('-', '_'), node_id_clean.replace('_', '-')))
            row = c.fetchone()
            return dict(row) if row else None
        except Exception as e:
            logger.error(f"Error fetching subnode globally: {e}")
            return None
        finally:
            conn.close()

    def update_subnode_maintenance(self, lab_id, node_id, maintenance_mode):
        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()
        try:
            c.execute("UPDATE subnodes SET maintenance_mode = ? WHERE id = ? AND labId = ?", (1 if maintenance_mode else 0, node_id, lab_id))
            conn.commit()
        except Exception as e:
            logger.error(f"Error updating subnode maintenance: {e}")
        finally:
            conn.close()

    def save_individual_node_telemetry(self, lab_id, node_id, metrics, raw_payload=""):
        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()
        try:
            import datetime as dt
            now_str = dt.datetime.now().isoformat()
            
            # Extract values dynamically from metrics dict
            t_c = metrics.get("temperature_c", metrics.get("temperature", None))
            h_p = metrics.get("humidity_pct", metrics.get("humidity", None))
            pm = metrics.get("pm25_ugm3", metrics.get("pm25", None))
            co2 = metrics.get("co2_ppm", metrics.get("co2", None))
            light = metrics.get("light_lux", metrics.get("lux", None))
            lat = metrics.get("latitude", metrics.get("lat", None))
            lng = metrics.get("longitude", metrics.get("lng", None))
            alt = metrics.get("altitude_m", metrics.get("altitude", None))
            spd = metrics.get("speed_kmph", metrics.get("speed", None))
            sats = metrics.get("satellites", metrics.get("sats", None))
            s_ok = metrics.get("dht_ok", metrics.get("gnss_ok", metrics.get("status_ok", True)))
            
            c.execute("""
                INSERT INTO node_telemetry_history 
                    (node_id, labId, temperature, humidity, pm25, co2, light, latitude, longitude, altitude, speed, satellites, sensor_ok, raw_payload, receivedAt)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                str(node_id), str(lab_id), t_c, h_p, pm, co2, light, lat, lng, alt, spd, sats, 1 if s_ok else 0, str(raw_payload), now_str
            ))
            conn.commit()
        except Exception as e:
            logger.error(f"Error saving individual node telemetry: {e}")
        finally:
            conn.close()

    def get_individual_node_telemetry(self, lab_id, node_id, limit=50):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        c = conn.cursor()
        try:
            c.execute("SELECT * FROM node_telemetry_history WHERE node_id = ? AND labId = ? ORDER BY id DESC LIMIT ?", (node_id, lab_id, limit))
            rows = c.fetchall()
            return [dict(row) for row in rows]
        except Exception as e:
            logger.error(f"Error reading node telemetry history: {e}")
            return []
        finally:
            conn.close()





