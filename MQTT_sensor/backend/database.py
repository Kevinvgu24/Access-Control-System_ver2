import sqlite3
import datetime as dt
from logger import get_logger

logger = get_logger("database_sensors")

class SensorDatabase:
    """
    Sensor Database Interface for MQTT Telemetry, Subnode Registry, & Historical Records.
    Note: Unrelated authentication & biometric user data structures have been redacted for security & privacy.
    """
    def __init__(self, db_path="smart_door.db"):
        self.db_path = db_path
        self._init_db()

    def _init_db(self):
        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()
        c.execute("PRAGMA journal_mode=WAL;")
        
        # ... [SECURITY REDACTED: Biometric Face Embeddings, User Accounts, & Access PIN Tables] ...

        # 1. Table: Subnodes Registry (ESP32 MQTT Hardware Sensors)
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

        # 2. Table: Combined Environment Telemetry History
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
                dht_ok INTEGER,
                gnss_ok INTEGER,
                raw_payload TEXT,
                receivedAt TEXT
            )
        ''')

        # 3. Table: Individual Node Telemetry History
        c.execute('''
            CREATE TABLE IF NOT EXISTS node_telemetry_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                labId TEXT,
                node_id TEXT,
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
                sensor_ok INTEGER,
                raw_payload TEXT,
                receivedAt TEXT
            )
        ''')

        conn.commit()
        conn.close()

    # =========================================================================
    # SENSOR SUBNODE REGISTRY METHODS
    # =========================================================================

    def save_subnode(self, lab_id, node_id, name, sensors="Dynamic MQTT Sensors", maintenance_mode=0):
        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()
        try:
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

    def update_subnode_maintenance(self, lab_id, node_id, maintenance_mode):
        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()
        try:
            c.execute("UPDATE subnodes SET maintenance_mode = ? WHERE id = ?", (1 if maintenance_mode else 0, node_id))
            conn.commit()
        except Exception as e:
            logger.error(f"Error updating subnode maintenance mode: {e}")
        finally:
            conn.close()

    # =========================================================================
    # SENSOR TELEMETRY HISTORY METHODS
    # =========================================================================

    def save_sensor_telemetry(self, lab_id, temperature, humidity, latitude, longitude, altitude, speed, satellites, dht_ok=True, gnss_ok=True, raw_payload=""):
        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()
        try:
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

    def save_individual_node_telemetry(self, lab_id, node_id, metrics, raw_payload=""):
        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()
        try:
            now_str = dt.datetime.now().isoformat()
            temp = float(metrics.get("temperature_c", metrics.get("temperature", 0.0)))
            hum = float(metrics.get("humidity_pct", metrics.get("humidity", 0.0)))
            pm25 = float(metrics.get("pm25_ugm3", metrics.get("pm25", 0.0)))
            co2 = float(metrics.get("co2_ppm", metrics.get("co2", 0.0)))
            light = float(metrics.get("light_lux", metrics.get("lux", 0.0)))
            lat = float(metrics.get("latitude", metrics.get("lat", 0.0)))
            lng = float(metrics.get("longitude", metrics.get("lng", 0.0)))
            alt = float(metrics.get("altitude_m", metrics.get("altitude", 0.0)))
            spd = float(metrics.get("speed_kmph", metrics.get("speed", 0.0)))
            sats = int(metrics.get("satellites", metrics.get("sats", 0)))
            ok_flag = 1 if metrics.get("dht_ok", metrics.get("gnss_ok", metrics.get("sensor_ok", True))) else 0

            c.execute("""
                INSERT INTO node_telemetry_history 
                    (labId, node_id, temperature, humidity, pm25, co2, light, latitude, longitude, altitude, speed, satellites, sensor_ok, raw_payload, receivedAt)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (lab_id, node_id, temp, hum, pm25, co2, light, lat, lng, alt, spd, sats, ok_flag, str(raw_payload), now_str))
            conn.commit()
        except Exception as e:
            logger.error(f"Error saving individual node telemetry: {e}")
        finally:
            conn.close()

    def get_individual_node_history(self, lab_id, node_id, limit=100):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        c = conn.cursor()
        try:
            c.execute("SELECT * FROM node_telemetry_history WHERE node_id = ? AND labId = ? ORDER BY id DESC LIMIT ?", (node_id, lab_id, limit))
            rows = c.fetchall()
            return [dict(r) for r in rows]
        except Exception as e:
            logger.error(f"Error fetching individual node history: {e}")
            return []
        finally:
            conn.close()

    # ... [SECURITY REDACTED: Face Recognition Vector Indexing, Biometric Log Ingestion, & Access Control Verification Methods] ...

# Alias for compatibility
FaceDatabase = SensorDatabase


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
                createdAt TEXT,
                updatedAt TEXT,
                UNIQUE(labId, serial_number)
            )
        ''')
        # Alter table for existing databases to add missing borrowing columns
        borrow_cols = [
            ("borrower_name", "TEXT"),
            ("borrower_id", "TEXT"),
            ("borrow_date", "TEXT"),
            ("return_date", "TEXT"),
            ("borrow_notes", "TEXT")
        ]
        for col_name, col_type in borrow_cols:
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
                   borrower_name, borrower_id, borrow_date, return_date, borrow_notes, createdAt, updatedAt
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
                "createdAt": r[15] or "",
                "updatedAt": r[16] or ""
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
                                   borrower_name, borrower_id, borrow_date, return_date, borrow_notes, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                borrower_name = ?, borrower_id = ?, borrow_date = ?, return_date = ?, borrow_notes = ?, updatedAt = ?
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
