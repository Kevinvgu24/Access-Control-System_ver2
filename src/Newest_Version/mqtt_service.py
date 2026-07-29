import os
import json
import time
import threading
from datetime import datetime
from logger import get_logger

logger = get_logger("mqtt_service")

# Global in-memory cache for Multi-Lab state
labs_registry = {}
rejected_subnodes = set()

def get_lab_state(lab_id):
    if lab_id not in labs_registry:
        labs_registry[lab_id] = {
            "pending_subnodes": {},
            "subnodes": {},
            "latest_sensor_data": {
                "temperature": 0.0,
                "humidity": 0.0,
                "latitude": 0.0,
                "longitude": 0.0,
                "altitude": 0.0,
                "speed": 0.0,
                "satellites": 0,
                "pm25": 0.0,
                "co2": 0.0,
                "light": 0.0,
                "dht_ok": False,
                "gnss_ok": False,
                "last_updated": None,
                "online": False,
                "subnodes": []
            }
        }
    return labs_registry[lab_id]

def extract_lab_id(topic):
    # Expected format: smartdoor/{lab_id}/sensors/...
    if topic.startswith("smartdoor/"):
        sensors_idx = topic.find("/sensors/")
        if sensors_idx != -1:
            extracted = topic[len("smartdoor/"):sensors_idx]
            if extracted:
                return extracted
        parts = topic.split('/')
        if len(parts) >= 2 and parts[1]:
            return parts[1]
    return "lab_1"


class MQTTTelemetryService:
    def __init__(self, db_instance, broker_host=None, broker_port=None, topics=None):
        self.db = db_instance
        self.broker_host = broker_host or os.getenv("MQTT_BROKER_HOST", "broker.emqx.io")
        self.broker_port = int(broker_port or os.getenv("MQTT_BROKER_PORT", 1883))
        self.topics = topics or [
            "smartdoor/#",
            "smartlab/#"
        ]
        self.client = None
        self.running = False
        self.thread = None
        self.watchdog_thread = None
        
        # Restore previously approved subnodes from Database to memory
        if self.db:
            # We fetch all labs from database to populate memory on startup
            try:
                conn = self.db.db_path
                import sqlite3
                c = sqlite3.connect(conn).cursor()
                c.execute("SELECT DISTINCT labId FROM subnodes")
                lab_ids = [row[0] for row in c.fetchall() if row[0]]
                if not lab_ids: lab_ids = ["lab_1"]
                
                total_restored = 0
                for lab_id in lab_ids:
                    state = get_lab_state(lab_id)
                    saved_nodes = self.db.get_all_subnodes(lab_id=lab_id)
                    for node_id, data in saved_nodes.items():
                        if node_id not in state["subnodes"]:
                            state["subnodes"][node_id] = {
                                "id": node_id,
                                "name": data.get("name", f"Subnode ({node_id})"),
                                "sensors": data.get("sensors", "Dynamic MQTT Sensors"),
                                "online": False,
                                "sensor_ok": False,
                                "maintenance_mode": bool(data.get("maintenance_mode", 0)),
                                "error_msg": "Disconnected for maintenance" if data.get("maintenance_mode", 0) else "Offline (Awaiting telemetry since reboot)",
                                "last_updated": datetime.now().astimezone().isoformat(),
                                "last_updated_ts": 0,
                                "connected_at_ts": 0,
                                "capabilities": [],
                                "data": {}
                            }
                            total_restored += 1
                logger.info(f"Restored {total_restored} approved subnodes from database across {len(lab_ids)} labs.")
            except Exception as e:
                logger.error(f"Failed to restore subnodes: {e}")

    def start(self):
        self.running = True
        self.thread = threading.Thread(target=self._run_loop, daemon=True)
        self.thread.start()
        
        self.watchdog_thread = threading.Thread(target=self._watchdog_loop, daemon=True)
        self.watchdog_thread.start()
        logger.info(f"MQTT Telemetry Service thread started (Subscribed to {self.broker_host}:{self.broker_port})")

    def _watchdog_loop(self):
        """Watchdog thread that marks subnodes offline if no message received within 15 seconds, and purges unapproved pending requests after 10 seconds"""
        while self.running:
            time.sleep(2)
            now = time.time()
            
            for lab_id, state in list(labs_registry.items()):
                any_subnode_online = False

                # 1. Clean up pending pairing requests if ESP32 is turned off / disconnects before approval (15s timeout or invalid last_seen)
                for pending_id, pending_node in list(state["pending_subnodes"].items()):
                    last_seen = pending_node.get("last_seen_ts", 0)
                    if last_seen <= 0 or (now - last_seen) > 15.0:
                        del state["pending_subnodes"][pending_id]
                        logger.info(f"[{lab_id}] Purged expired pending ESP32 pairing request for '{pending_id}' (timeout > 15s)")

                # 2. Check telemetry timeouts for approved subnodes
                for node_id, node in list(state["subnodes"].items()):
                    last_ts = node.get("last_updated_ts", 0)
                    if last_ts > 0 and (now - last_ts) > 15:
                        node["online"] = False
                        node["error_msg"] = "Telemetry timeout (> 15 seconds)"
                    elif last_ts > 0:
                        any_subnode_online = True
                
                state["latest_sensor_data"]["online"] = any_subnode_online
                state["latest_sensor_data"]["subnodes"] = list(state["subnodes"].values())

    def _run_loop(self):
        try:
            import paho.mqtt.client as mqtt
        except ImportError:
            logger.warning("paho-mqtt library is not installed. MQTT listener in mock mode.")
            return

        def on_connect(client, userdata, flags, rc):
            if rc == 0:
                logger.info(f"Successfully connected to MQTT Broker at {self.broker_host}:{self.broker_port}")
                for topic in self.topics:
                    client.subscribe(topic)
                    logger.info(f"Subscribed to MQTT topic: {topic}")
            else:
                logger.error(f"MQTT Connection failed with code {rc}")

        def on_message(client, userdata, msg):
            try:
                payload_str = msg.payload.decode("utf-8", errors="ignore")
                # Sanitize non-standard float representations (nan, NaN, inf) into standard JSON numbers
                payload_str_clean = payload_str.replace("nan", "0.0").replace("NaN", "0.0").replace("inf", "0.0").replace("Infinity", "0.0")
                data = json.loads(payload_str_clean)
                if "manifest" in msg.topic:
                    self.process_manifest_payload(msg.topic, data)
                else:
                    self.process_telemetry_payload(msg.topic, data)
            except Exception as e:
                logger.error(f"Error parsing MQTT message from {msg.topic}: {e} | Raw Payload: {msg.payload.decode('utf-8', errors='ignore')}")

        while self.running:
            try:
                try:
                    self.client = mqtt.Client(client_id="SmartLab_RPi5_Server", clean_session=True)
                except Exception:
                    self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION1, client_id="SmartLab_RPi5_Server")

                self.client.on_connect = on_connect
                self.client.on_message = on_message

                logger.info(f"Connecting to MQTT Broker {self.broker_host}:{self.broker_port}...")
                self.client.connect(self.broker_host, self.broker_port, 60)
                self.client.loop_forever()
            except Exception as e:
                logger.warning(f"MQTT connection lost or broker unreachable: {e}. Retrying in 10 seconds...")
                time.sleep(10)

    def process_manifest_payload(self, topic, data):
        lab_id = extract_lab_id(topic)
        
        node_id = str(data.get("node_id", data.get("subnode_id", ""))).strip()
        if not node_id or node_id == "subnode_unknown":
            topic_parts = topic.split('/')
            if len(topic_parts) >= 3 and topic_parts[1] == "subnodes":
                node_id = topic_parts[2]
            elif len(topic_parts) >= 4 and topic_parts[2] == "subnodes":
                node_id = topic_parts[3]
            else:
                node_id = "subnode_unknown"

        device_name = data.get("device_name", f"ESP32 Subnode ({node_id})")
        capabilities = data.get("capabilities", [])

        sensor_names = [cap.get("name", cap.get("id")) for cap in capabilities]
        sensors_str = ", ".join(sensor_names) if sensor_names else "Dynamic Sensor Cluster"

        # Check if node is approved in memory OR SQLite DB
        db_node = self.db.get_subnode_globally(node_id) if self.db else None
        target_lab_id = (db_node.get("labId") if db_node else None) or lab_id
        state = get_lab_state(target_lab_id)

        is_approved = bool(db_node) or node_id in state["subnodes"]
        if not is_approved:
            for lid, lstate in list(labs_registry.items()):
                for sid in lstate.get("subnodes", {}):
                    if sid.lower().strip() == node_id.lower().strip():
                        is_approved = True
                        state = lstate
                        node_id = sid
                        break
                if is_approved:
                    break

        if not is_approved:
            # Unapproved node sent a manifest: delegate to process_telemetry_payload to queue into pending_subnodes
            self.process_telemetry_payload(topic, data)
            return

        # Always purge approved subnodes from any pending queues across all labs
        for lid, lstate in list(labs_registry.items()):
            p_queue = lstate.get("pending_subnodes", {})
            for pk in list(p_queue.keys()):
                if pk.lower().strip() in [node_id.lower().strip(), node_id.lower().replace('-', '_'), node_id.lower().replace('_', '-')]:
                    p_queue.pop(pk, None)

        if node_id not in state["subnodes"]:
            state["subnodes"][node_id] = {
                "id": node_id,
                "name": (db_node.get("name") if db_node else device_name),
                "sensors": (db_node.get("sensors") if db_node else sensors_str),
                "online": True,
                "sensor_ok": True,
                "maintenance_mode": False,
                "error_msg": None,
                "last_updated": datetime.now().astimezone().isoformat(),
                "last_updated_ts": time.time(),
                "connected_at_ts": time.time(),
                "capabilities": capabilities,
                "data": {}
            }
        else:
            if not state["subnodes"][node_id].get("name"):
                state["subnodes"][node_id]["name"] = device_name
            state["subnodes"][node_id]["sensors"] = sensors_str
            state["subnodes"][node_id]["capabilities"] = capabilities

        logger.info(f"[{target_lab_id}] Updated ESP32 Manifest for approved subnode '{node_id}': {sensors_str}")

    def process_telemetry_payload(self, topic, data):
        lab_id = extract_lab_id(topic)
        state = get_lab_state(lab_id)
        
        now_iso = datetime.now().astimezone().isoformat()
        now_ts = time.time()

        # Extract exact node ID sent by ESP32, fallback to topic segment
        raw_node_id = str(data.get("node_id", data.get("subnode_id", ""))).strip()
        if not raw_node_id or raw_node_id == "unknown_esp32_device":
            topic_parts = topic.split('/')
            if len(topic_parts) >= 3 and topic_parts[1] == "subnodes":
                raw_node_id = topic_parts[2]
            elif len(topic_parts) >= 4 and topic_parts[2] == "subnodes":
                raw_node_id = topic_parts[3]
            else:
                raw_node_id = "unknown_esp32_device"

        # Query SQLite to check if node was approved in database
        db_node = self.db.get_subnode_globally(raw_node_id) if self.db else None

        # Check if node is approved in memory OR SQLite DB
        target_lab_id = (db_node.get("labId") if db_node else None) or lab_id
        target_state = get_lab_state(target_lab_id)

        is_approved = False
        if db_node or raw_node_id in target_state["subnodes"]:
            is_approved = True
            state = target_state
            if raw_node_id not in state["subnodes"] and db_node:
                state["subnodes"][raw_node_id] = {
                    "id": raw_node_id,
                    "name": db_node.get("name", f"Subnode ({raw_node_id})"),
                    "sensors": db_node.get("sensors", "Dynamic MQTT Sensors"),
                    "online": True,
                    "sensor_ok": True,
                    "maintenance_mode": bool(db_node.get("maintenance_mode", 0)),
                    "error_msg": None,
                    "last_updated": now_iso,
                    "last_updated_ts": now_ts,
                    "connected_at_ts": now_ts,
                    "capabilities": [],
                    "data": data
                }
        else:
            # Check other labs in memory
            for lid, lstate in list(labs_registry.items()):
                for sid in lstate.get("subnodes", {}):
                    if sid.lower().strip() == raw_node_id.lower().strip():
                        is_approved = True
                        state = lstate
                        raw_node_id = sid
                        break
                if is_approved:
                    break

        if is_approved:
            # Always purge approved subnodes and case variants from pending queues across all labs
            for lid, lstate in list(labs_registry.items()):
                p_queue = lstate.get("pending_subnodes", {})
                for pk in list(p_queue.keys()):
                    if pk.lower().strip() in [raw_node_id.lower().strip(), raw_node_id.lower().replace('-', '_'), raw_node_id.lower().replace('_', '-')]:
                        p_queue.pop(pk, None)

        if not is_approved:
            # If node was rejected by admin, ignore telemetry payload and do not re-add to pairing queue
            if raw_node_id in rejected_subnodes:
                return

            # Unrecognized / unapproved ESP32 subnode: MUST go into pending queue!
            pending_lab_id = target_lab_id
            pending_state = state
            existing_pending = {}

            for lid, lstate in list(labs_registry.items()):
                if raw_node_id in lstate.get("pending_subnodes", {}):
                    pending_lab_id = lid
                    pending_state = lstate
                    existing_pending = lstate["pending_subnodes"][raw_node_id]
                    break

            # Determine readable sensors string
            sensors_str = data.get("sensors") or existing_pending.get("sensors")
            if not sensors_str or sensors_str == "Dynamic MQTT Sensors":
                if "temperature" in data or "dht_ok" in data or "DHT11" in raw_node_id or "dht" in topic.lower():
                    sensors_str = "DHT11 Temp & Humidity"
                elif "latitude" in data or "gnss_ok" in data or "speed" in data or "GPS" in raw_node_id or "gps" in topic.lower():
                    sensors_str = "LC76G GNSS GPS"
                else:
                    sensors_str = "Dynamic MQTT Sensors"

            # Determine readable device name
            device_name = data.get("device_name") or existing_pending.get("name")
            if not device_name or device_name.startswith("Discovered ESP32"):
                if "DHT11" in sensors_str or "DHT11" in raw_node_id or "dht" in topic.lower():
                    device_name = "ESP32 Subnode 1 (DHT11)"
                elif "GPS" in sensors_str or "GPS" in raw_node_id or "gps" in topic.lower():
                    device_name = "ESP32 Subnode 2 (LC76G GPS)"
                else:
                    device_name = f"Discovered ESP32 ({raw_node_id})"

            if raw_node_id not in pending_state["pending_subnodes"]:
                logger.info(f"[{pending_lab_id}] Queued unapproved ESP32 Subnode '{raw_node_id}' ({device_name}) in pairing queue.")

            pending_state["pending_subnodes"][raw_node_id] = {
                "id": raw_node_id,
                "name": device_name,
                "sensors": sensors_str,
                "topic": topic,
                "discovered_at": existing_pending.get("discovered_at", now_iso),
                "last_seen_ts": now_ts,
                "sample_data": data
            }
            return

        if raw_node_id not in state["subnodes"]:
            state["subnodes"][raw_node_id] = {
                "id": raw_node_id,
                "name": (db_node.get("name") if db_node else f"Subnode ({raw_node_id})"),
                "sensors": (db_node.get("sensors") if db_node else "Dynamic MQTT Sensors"),
                "online": True,
                "sensor_ok": True,
                "maintenance_mode": False,
                "error_msg": None,
                "last_updated": now_iso,
                "last_updated_ts": now_ts,
                "connected_at_ts": now_ts,
                "capabilities": [],
                "data": data
            }

        target_node = state["subnodes"][raw_node_id]

        # Check if node is currently in Maintenance Disconnect mode
        if target_node.get("maintenance_mode", False):
            target_node["online"] = False
            target_node["sensor_ok"] = False
            target_node["error_msg"] = "Disconnected for maintenance"
            target_node["last_updated"] = now_iso
            target_node["last_updated_ts"] = now_ts
            return

        target_node["online"] = True
        target_node["last_updated"] = now_iso
        target_node["last_updated_ts"] = now_ts
        
        sensor_ok = data.get("dht_ok", data.get("gnss_ok", data.get("status_ok", data.get("sensor_ok", True))))
        target_node["sensor_ok"] = bool(sensor_ok)
        target_node["error_msg"] = data.get("error", data.get("error_msg", None if target_node["sensor_ok"] else "Sensor anomaly reported"))

        if not target_node.get("connected_at_ts"):
            target_node["connected_at_ts"] = now_ts

        # Merge dynamic metric key-values into subnode data
        esp_uptime_sec = 0
        metrics = data.get("metrics", data)
        for k, v in metrics.items():
            if k in ["node_id", "status_ok", "sensor_status", "error_msg", "device_name", "subnode_id"]:
                continue
            if k in ["timestamp_ms", "timestamp"]:
                if isinstance(v, (int, float)) and v < 1e11:
                    esp_uptime_sec = int(v / 1000.0)
                    continue
            target_node["data"][k] = v

        # Calculate sensor active duration (hours, minutes, seconds)
        conn_sec = int(now_ts - target_node["connected_at_ts"])
        total_active_sec = max(conn_sec, esp_uptime_sec)

        hrs = total_active_sec // 3600
        mins = (total_active_sec % 3600) // 60
        secs = total_active_sec % 60
        active_str = f"{hrs}h {mins}m {secs}s" if hrs > 0 else f"{mins}m {secs}s"

        target_node["data"]["sensor_active_duration"] = active_str
        target_node["data"]["date_time"] = datetime.now().astimezone().strftime("%d/%m/%Y %H:%M:%S")

        # Cleanup raw confusing keys
        target_node["data"].pop("timestamp_ms", None)
        target_node["data"].pop("timestamp", None)
        target_node["data"].pop("uptime_seconds", None)

        # Dynamic sensor name generator if not already registered via manifest
        metric_keys = list(target_node["data"].keys())
        if metric_keys:
            readable_sensors = []
            if "temperature_c" in metric_keys or "temperature" in metric_keys:
                readable_sensors.append("DHT11 Temp & Hum")
            if "latitude" in metric_keys or "gnss" in metric_keys:
                readable_sensors.append("LC76G GNSS GPS")
            if "pm25_ugm3" in metric_keys or "pm25" in metric_keys:
                readable_sensors.append("PM2.5 Fine Dust")
            if "co2_ppm" in metric_keys or "co2" in metric_keys:
                readable_sensors.append("CO2 Sensor")
            if "light_lux" in metric_keys or "lux" in metric_keys:
                readable_sensors.append("Ambient Light Lux")
            if readable_sensors:
                target_node["sensors"] = " + ".join(readable_sensors)

        # Update global combined summary metrics
        latest_data = state["latest_sensor_data"]
        if "temperature_c" in target_node["data"] or "temperature" in target_node["data"]:
            latest_data["temperature"] = float(target_node["data"].get("temperature_c", target_node["data"].get("temperature", 0.0)))
            latest_data["humidity"] = float(target_node["data"].get("humidity_pct", target_node["data"].get("humidity", 0.0)))
            latest_data["dht_ok"] = target_node["sensor_ok"]

        if "latitude" in target_node["data"] or "lat" in target_node["data"]:
            latest_data["latitude"] = float(target_node["data"].get("latitude", target_node["data"].get("lat", 0.0)))
            latest_data["longitude"] = float(target_node["data"].get("longitude", target_node["data"].get("lng", 0.0)))
            latest_data["altitude"] = float(target_node["data"].get("altitude_m", target_node["data"].get("altitude", 0.0)))
            latest_data["speed"] = float(target_node["data"].get("speed_kmph", target_node["data"].get("speed", 0.0)))
            latest_data["satellites"] = int(target_node["data"].get("satellites", target_node["data"].get("sats", 0)))
            latest_data["gnss_ok"] = target_node["sensor_ok"]

        if "pm25_ugm3" in target_node["data"] or "pm25" in target_node["data"]:
            latest_data["pm25"] = float(target_node["data"].get("pm25_ugm3", target_node["data"].get("pm25", 0.0)))

        if "co2_ppm" in target_node["data"] or "co2" in target_node["data"]:
            latest_data["co2"] = float(target_node["data"].get("co2_ppm", target_node["data"].get("co2", 0.0)))

        if "light_lux" in target_node["data"] or "lux" in target_node["data"]:
            latest_data["light"] = float(target_node["data"].get("light_lux", target_node["data"].get("lux", 0.0)))

        latest_data["last_updated"] = now_iso
        latest_data["online"] = True
        latest_data["subnodes"] = list(state["subnodes"].values())

        # Save telemetry event to database
        if self.db:
            self.db.save_sensor_telemetry(
                lab_id=target_lab_id,
                temperature=latest_data["temperature"],
                humidity=latest_data["humidity"],
                latitude=latest_data["latitude"],
                longitude=latest_data["longitude"],
                altitude=latest_data["altitude"],
                speed=latest_data["speed"],
                satellites=latest_data["satellites"],
                dht_ok=latest_data["dht_ok"],
                gnss_ok=latest_data["gnss_ok"],
                raw_payload=json.dumps(data)
            )
            
            # Save individual node telemetry history
            self.db.save_individual_node_telemetry(
                lab_id=target_lab_id,
                node_id=raw_node_id,
                metrics=target_node["data"],
                raw_payload=json.dumps(data)
            )

        logger.info(f"[{target_lab_id}] Ingested dynamic subnode '{raw_node_id}' metrics: {target_node['data']}")
