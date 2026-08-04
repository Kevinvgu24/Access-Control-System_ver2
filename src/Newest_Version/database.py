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
        
        # 1. Tạo bảng users mở rộng
        c.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE,
                university_id TEXT UNIQUE,
                email TEXT UNIQUE,
                password TEXT,
                role TEXT DEFAULT 'student',
                status TEXT DEFAULT 'active',
                faceStatus TEXT DEFAULT 'complete',
                pinStatus TEXT DEFAULT 'set',
                pin TEXT,
                embedding array,
                createdAt TEXT,
                updatedAt TEXT
            )
        ''')

        # Thêm các cột nếu chưa có (trong trường hợp DB cũ đã tồn tại)
        columns_to_add = [
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
                status TEXT DEFAULT 'active',
                createdAt TEXT,
                updatedAt TEXT
            )
        ''')
        
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

        # Add synced column to access_events and incidents if they don't exist in existing database
        for col_name, table_name in [("synced", "access_events"), ("synced", "incidents")]:
            try:
                c.execute(f"ALTER TABLE {table_name} ADD COLUMN {col_name} INTEGER DEFAULT 0")
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
            import hashlib
            # Sử dụng SHA256 để mã hóa mật khẩu đơn giản
            pw_hash = hashlib.sha256("admin123".encode()).hexdigest()
            c.execute("INSERT INTO admins (id, email, password, displayName, type, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
                      ("default-admin", "dawnnkevin9@gmail.com", pw_hash, "Kevin", "super_admin", "active", now_str))

        conn.commit()
        conn.close()

    def save_user(self, name, embedding):
        conn = sqlite3.connect(self.db_path, detect_types=sqlite3.PARSE_DECLTYPES)
        c = conn.cursor()
        try:
            # Kiểm tra xem user đã tồn tại chưa để tránh ghi đè các cột thông tin cá nhân
            c.execute("SELECT id FROM users WHERE name = ?", (name,))
            row = c.fetchone()
            if row:
                c.execute("UPDATE users SET embedding = ?, faceStatus = 'complete' WHERE name = ?", (embedding, name))
            else:
                import datetime as dt
                now_str = dt.datetime.now().isoformat()
                c.execute("INSERT INTO users (name, embedding, status, faceStatus, createdAt, updatedAt) VALUES (?, ?, 'active', 'complete', ?, ?)", 
                          (name, embedding, now_str, now_str))
            conn.commit()
            logger.info(f"Đã lưu/cập nhật hồ sơ: {name}")
        except Exception as e:
            logger.error(f"Lỗi khi lưu {name}: {e}")
        finally:
            conn.close()

    def delete_user(self, name):
        conn = sqlite3.connect(self.db_path, detect_types=sqlite3.PARSE_DECLTYPES)
        c = conn.cursor()
        try:
            c.execute("DELETE FROM users WHERE name = ?", (name,))
            conn.commit()
            logger.info(f"Đã xóa vĩnh viễn hồ sơ: {name}")
        except Exception as e:
            logger.error(f"Lỗi khi xóa {name}: {e}")
        finally:
            conn.close()

    def load_all_users(self):
        conn = sqlite3.connect(self.db_path, detect_types=sqlite3.PARSE_DECLTYPES)
        c = conn.cursor()
        c.execute("SELECT name, embedding FROM users WHERE embedding IS NOT NULL")
        rows = c.fetchall()
        conn.close()
        return {row[0]: row[1] for row in rows}

    def save_full_user(self, name, university_id, email, password, role, status, pin, embedding=None):
        conn = sqlite3.connect(self.db_path, detect_types=sqlite3.PARSE_DECLTYPES)
        c = conn.cursor()
        try:
            import datetime as dt
            now_str = dt.datetime.now().isoformat()
            
            c.execute("SELECT id FROM users WHERE name = ? OR email = ?", (name, email))
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
                        (name, university_id, email, password, role, status, pin, embedding, faceStatus, pinStatus, createdAt, updatedAt)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (name, university_id, email, password, role, status, pin, embedding, 
                      'complete' if embedding is not None else 'incomplete',
                      'set' if pin else 'missing', now_str, now_str))
            conn.commit()
            logger.info(f"Saved full user profile: {name} ({email})")
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

    def update_node_telemetry(self, nodeId, status, onlineState, cameraFps, cpuPercent, ramPercent, temperatureC):
        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()
        try:
            import datetime as dt
            import json
            now_str = dt.datetime.now().isoformat()
            
            telemetry_data = {
                "heartbeatAt": now_str,
                "onlineState": onlineState,
                "cpuPercent": cpuPercent,
                "ramPercent": ramPercent,
                "cameraFps": cameraFps,
                "temperatureC": temperatureC,
                "updatedAt": now_str
            }
            telemetry_json = json.dumps(telemetry_data)

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






    # Equipment Management Methods
    def _ensure_equipment_table(self, conn):
        c = conn.cursor()
        c.execute('''
            CREATE TABLE IF NOT EXISTS equipment (
                id TEXT PRIMARY KEY,
                labId TEXT NOT NULL,
                serial_number TEXT NOT NULL,
                name TEXT NOT NULL,
                category TEXT DEFAULT 'Module',
                status TEXT DEFAULT 'available',
                assigned_to TEXT,
                location TEXT,
                specs TEXT,
                notes TEXT,
                borrower_name TEXT,
                borrower_id TEXT,
                borrow_date TEXT,
                return_date TEXT,
                borrow_notes TEXT,
                image TEXT,
                createdAt TEXT,
                updatedAt TEXT,
                UNIQUE(labId, serial_number)
            )
        ''')
        # Alter table for existing databases to add missing columns
        extra_cols = [
            ("borrower_name", "TEXT"),
            ("borrower_id", "TEXT"),
            ("borrow_date", "TEXT"),
            ("return_date", "TEXT"),
            ("borrow_notes", "TEXT"),
            ("image", "TEXT")
        ]
        for col_name, col_type in extra_cols:
            try:
                c.execute(f"ALTER TABLE equipment ADD COLUMN {col_name} {col_type}")
            except sqlite3.OperationalError:
                pass
        conn.commit()

    def get_equipment(self, lab_id):
        conn = sqlite3.connect(self.db_path)
        self._ensure_equipment_table(conn)
        c = conn.cursor()
        c.execute('''
            SELECT id, labId, serial_number, name, category, status, assigned_to, location, specs, notes,
                   borrower_name, borrower_id, borrow_date, return_date, borrow_notes, image, createdAt, updatedAt
            FROM equipment WHERE labId = ? ORDER BY serial_number ASC
        ''', (lab_id,))
        rows = c.fetchall()
        conn.close()
        items = []
        for r in rows:
            items.append({
                "id": r[0],
                "labId": r[1],
                "serialNumber": r[2],
                "name": r[3],
                "category": r[4],
                "status": r[5],
                "assignedTo": r[6] or "",
                "location": r[7] or "",
                "specs": r[8] or "",
                "notes": r[9] or "",
                "borrowerName": r[10] or "",
                "borrowerId": r[11] or "",
                "borrowDate": r[12] or "",
                "returnDate": r[13] or "",
                "borrowNotes": r[14] or "",
                "image": r[15] or "",
                "createdAt": r[16] or "",
                "updatedAt": r[17] or ""
            })
        return items

    def add_equipment(self, eq_data):
        import uuid, datetime
        conn = sqlite3.connect(self.db_path)
        self._ensure_equipment_table(conn)
        c = conn.cursor()
        now = datetime.datetime.now().isoformat()
        eq_id = eq_data.get("id") or f"eq_{uuid.uuid4().hex[:8]}"
        c.execute('''
            INSERT INTO equipment (id, labId, serial_number, name, category, status, assigned_to, location, specs, notes,
                                   borrower_name, borrower_id, borrow_date, return_date, borrow_notes, image, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            eq_id,
            eq_data.get("labId", "lab_1"),
            eq_data.get("serialNumber", ""),
            eq_data.get("name", ""),
            eq_data.get("category", "Module"),
            eq_data.get("status", "available"),
            eq_data.get("assignedTo", ""),
            eq_data.get("location", ""),
            eq_data.get("specs", ""),
            eq_data.get("notes", ""),
            eq_data.get("borrowerName", ""),
            eq_data.get("borrowerId", ""),
            eq_data.get("borrowDate", ""),
            eq_data.get("returnDate", ""),
            eq_data.get("borrowNotes", ""),
            eq_data.get("image", ""),
            now,
            now
        ))
        conn.commit()
        conn.close()
        return eq_id

    def update_equipment(self, eq_id, eq_data):
        import datetime
        conn = sqlite3.connect(self.db_path)
        self._ensure_equipment_table(conn)
        c = conn.cursor()
        now = datetime.datetime.now().isoformat()
        c.execute('''
            UPDATE equipment
            SET serial_number = ?, name = ?, category = ?, status = ?, assigned_to = ?, location = ?, specs = ?, notes = ?,
                borrower_name = ?, borrower_id = ?, borrow_date = ?, return_date = ?, borrow_notes = ?, image = ?, updatedAt = ?
            WHERE id = ?
        ''', (
            eq_data.get("serialNumber", ""),
            eq_data.get("name", ""),
            eq_data.get("category", "Module"),
            eq_data.get("status", "available"),
            eq_data.get("assignedTo", ""),
            eq_data.get("location", ""),
            eq_data.get("specs", ""),
            eq_data.get("notes", ""),
            eq_data.get("borrowerName", ""),
            eq_data.get("borrowerId", ""),
            eq_data.get("borrowDate", ""),
            eq_data.get("returnDate", ""),
            eq_data.get("borrowNotes", ""),
            eq_data.get("image", ""),
            now,
            eq_id
        ))
        conn.commit()
        conn.close()

    def borrow_equipment(self, eq_id, borrow_data):
        import datetime
        conn = sqlite3.connect(self.db_path)
        self._ensure_equipment_table(conn)
        c = conn.cursor()
        now = datetime.datetime.now().isoformat()
        c.execute('''
            UPDATE equipment
            SET status = 'in_use',
                borrower_name = ?,
                borrower_id = ?,
                borrow_date = ?,
                return_date = ?,
                borrow_notes = ?,
                updatedAt = ?
            WHERE id = ?
        ''', (
            borrow_data.get("borrowerName", ""),
            borrow_data.get("borrowerId", ""),
            borrow_data.get("borrowDate", ""),
            borrow_data.get("returnDate", ""),
            borrow_data.get("borrowNotes", ""),
            now,
            eq_id
        ))
        conn.commit()
        conn.close()

    def return_equipment(self, eq_id):
        import datetime
        conn = sqlite3.connect(self.db_path)
        self._ensure_equipment_table(conn)
        c = conn.cursor()
        now = datetime.datetime.now().isoformat()
        c.execute('''
            UPDATE equipment
            SET status = 'available',
                borrower_name = '',
                borrower_id = '',
                borrow_date = '',
                return_date = '',
                borrow_notes = '',
                updatedAt = ?
            WHERE id = ?
        ''', (now, eq_id))
        conn.commit()
        conn.close()

    def delete_equipment(self, eq_id):
        conn = sqlite3.connect(self.db_path)
        self._ensure_equipment_table(conn)
        c = conn.cursor()
        c.execute("DELETE FROM equipment WHERE id = ?", (eq_id,))
        conn.commit()
        conn.close()
