import os
import json
import time
import threading
from datetime import datetime
from logger import get_logger

logger = get_logger("mqtt_service")

# Global in-memory cache for Subnodes registry, pending pairing queue, and overall combined telemetry
pending_subnodes_queue = {}

subnodes_registry = {}

latest_sensor_data = {
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
    "subnodes": list(subnodes_registry.values())
}

class MQTTTelemetryService:
    def __init__(self, db_instance, broker_host=None, broker_port=None, topics=None):
        self.db = db_instance
        self.broker_host = broker_host or os.getenv("MQTT_BROKER_HOST", "broker.emqx.io")
        self.broker_port = int(broker_port or os.getenv("MQTT_BROKER_PORT", 1883))
        self.topics = topics or [
            "smartdoor/vgu24/sensors/#",
            "smartdoor/vgu24/sensors/dht11",
            "smartdoor/vgu24/sensors/gps",
            "smartdoor/sensors/telemetry",
            "smartdoor/subnodes/+/telemetry",
            "esp32/sensors/data"
        ]
        self.client = None
        self.running = False
        self.thread = None
        self.watchdog_thread = None

    def start(self):
        self.running = True
        self.thread = threading.Thread(target=self._run_loop, daemon=True)
        self.thread.start()
        
        self.watchdog_thread = threading.Thread(target=self._watchdog_loop, daemon=True)
        self.watchdog_thread.start()
        logger.info(f"MQTT Telemetry Service thread started (Subscribed to {self.broker_host}:{self.broker_port})")

    def _watchdog_loop(self):
        """Watchdog thread that marks subnodes offline if no message received within 15 seconds, and purges unapproved pending requests after 10 seconds"""
        global latest_sensor_data, subnodes_registry, pending_subnodes_queue
        while self.running:
            time.sleep(2)
            now = time.time()
            any_subnode_online = False

            # 1. Clean up pending pairing requests if ESP32 is turned off / disconnects before approval (10s timeout)
            for pending_id, pending_node in list(pending_subnodes_queue.items()):
                last_seen = pending_node.get("last_seen_ts", 0)
                if last_seen > 0 and (now - last_seen) > 10.0:
                    del pending_subnodes_queue[pending_id]
                    logger.info(f"Purged expired pending ESP32 pairing request for '{pending_id}' (device turned off or timeout > 10s)")

            # 2. Check telemetry timeouts for approved subnodes
            for node_id, node in list(subnodes_registry.items()):
                last_ts = node.get("last_updated_ts", 0)
                if last_ts > 0 and (now - last_ts) > 15:
                    node["online"] = False
                    node["error_msg"] = "Telemetry timeout (> 15 seconds)"
                elif last_ts > 0:
                    any_subnode_online = True
            
            latest_sensor_data["online"] = any_subnode_online
            latest_sensor_data["subnodes"] = list(subnodes_registry.values())

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
                payload_str = msg.payload.decode("utf-8")
                data = json.loads(payload_str)
                if "manifest" in msg.topic:
                    self.process_manifest_payload(msg.topic, data)
                else:
                    self.process_telemetry_payload(msg.topic, data)
            except Exception as e:
                logger.error(f"Error parsing MQTT message from {msg.topic}: {e}")

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
        global subnodes_registry
        node_id = data.get("node_id", "subnode_unknown")
        device_name = data.get("device_name", f"ESP32 Subnode ({node_id})")
        capabilities = data.get("capabilities", [])

        sensor_names = [cap.get("name", cap.get("id")) for cap in capabilities]
        sensors_str = ", ".join(sensor_names) if sensor_names else "Dynamic Sensor Cluster"

        if node_id not in subnodes_registry:
            subnodes_registry[node_id] = {
                "id": node_id,
                "name": device_name,
                "sensors": sensors_str,
                "online": True,
                "sensor_ok": True,
                "error_msg": None,
                "last_updated": datetime.now().astimezone().isoformat(),
                "capabilities": capabilities,
                "data": {}
            }
        else:
            if not subnodes_registry[node_id].get("name"):
                subnodes_registry[node_id]["name"] = device_name
            subnodes_registry[node_id]["sensors"] = sensors_str
            subnodes_registry[node_id]["capabilities"] = capabilities

        logger.info(f"Registered ESP32 Manifest for '{node_id}': {sensors_str}")

    def process_telemetry_payload(self, topic, data):
        global latest_sensor_data, subnodes_registry, pending_subnodes_queue
        now_iso = datetime.now().astimezone().isoformat()
        now_ts = time.time()

        # Extract exact node ID sent by ESP32
        raw_node_id = str(data.get("node_id", data.get("subnode_id", "")))
        if not raw_node_id:
            raw_node_id = "unknown_esp32_device"

        if raw_node_id in subnodes_registry:
            subnode_id = raw_node_id
        else:
            # Unrecognized / new ESP32 subnode detected via MQTT!
            # Put into pending discovery queue for user approval instead of auto-registering
            if raw_node_id not in pending_subnodes_queue:
                logger.info(f"Queued unapproved ESP32 Subnode '{raw_node_id}' in pairing queue.")

            pending_subnodes_queue[raw_node_id] = {
                "id": raw_node_id,
                "name": data.get("device_name", f"Discovered ESP32 ({raw_node_id})"),
                "sensors": data.get("sensors", "Dynamic MQTT Sensors"),
                "topic": topic,
                "discovered_at": now_iso,
                "last_seen_ts": now_ts,
                "sample_data": data
            }
            return

        target_node = subnodes_registry[subnode_id]

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

        # Extract dynamic metrics dictionary or flat root attributes
        metrics = data.get("metrics", data)

        # Merge dynamic metric key-values into subnode data
        for k, v in metrics.items():
            if k in ["node_id", "status_ok", "sensor_status", "error_msg", "device_name", "subnode_id"]:
                continue
            target_node["data"][k] = v

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
        if "temperature_c" in target_node["data"] or "temperature" in target_node["data"]:
            latest_sensor_data["temperature"] = float(target_node["data"].get("temperature_c", target_node["data"].get("temperature", 0.0)))
            latest_sensor_data["humidity"] = float(target_node["data"].get("humidity_pct", target_node["data"].get("humidity", 0.0)))
            latest_sensor_data["dht_ok"] = target_node["sensor_ok"]

        if "latitude" in target_node["data"] or "lat" in target_node["data"]:
            latest_sensor_data["latitude"] = float(target_node["data"].get("latitude", target_node["data"].get("lat", 0.0)))
            latest_sensor_data["longitude"] = float(target_node["data"].get("longitude", target_node["data"].get("lng", 0.0)))
            latest_sensor_data["altitude"] = float(target_node["data"].get("altitude_m", target_node["data"].get("altitude", 0.0)))
            latest_sensor_data["speed"] = float(target_node["data"].get("speed_kmph", target_node["data"].get("speed", 0.0)))
            latest_sensor_data["satellites"] = int(target_node["data"].get("satellites", target_node["data"].get("sats", 0)))
            latest_sensor_data["gnss_ok"] = target_node["sensor_ok"]

        if "pm25_ugm3" in target_node["data"] or "pm25" in target_node["data"]:
            latest_sensor_data["pm25"] = float(target_node["data"].get("pm25_ugm3", target_node["data"].get("pm25", 0.0)))

        if "co2_ppm" in target_node["data"] or "co2" in target_node["data"]:
            latest_sensor_data["co2"] = float(target_node["data"].get("co2_ppm", target_node["data"].get("co2", 0.0)))

        if "light_lux" in target_node["data"] or "lux" in target_node["data"]:
            latest_sensor_data["light"] = float(target_node["data"].get("light_lux", target_node["data"].get("lux", 0.0)))

        latest_sensor_data["last_updated"] = now_iso
        latest_sensor_data["online"] = True
        latest_sensor_data["subnodes"] = list(subnodes_registry.values())

        # Save telemetry event to database
        if self.db:
            self.db.save_sensor_telemetry(
                temperature=latest_sensor_data["temperature"],
                humidity=latest_sensor_data["humidity"],
                latitude=latest_sensor_data["latitude"],
                longitude=latest_sensor_data["longitude"],
                altitude=latest_sensor_data["altitude"],
                speed=latest_sensor_data["speed"],
                satellites=latest_sensor_data["satellites"],
                dht_ok=latest_sensor_data["dht_ok"],
                gnss_ok=latest_sensor_data["gnss_ok"],
                raw_payload=json.dumps(data)
            )

        logger.info(f"Ingested dynamic subnode '{subnode_id}' metrics: {target_node['data']}")
