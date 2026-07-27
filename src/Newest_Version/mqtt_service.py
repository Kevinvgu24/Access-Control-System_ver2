import json
import time
import threading
from datetime import datetime
from logger import get_logger

logger = get_logger("mqtt_service")

# Global in-memory cache for Subnodes registry and overall combined telemetry
subnodes_registry = {
    "subnode1": {
        "id": "subnode1",
        "name": "Subnode 1 - Environment",
        "sensors": "DHT11 Temp & Humidity",
        "online": False,
        "sensor_ok": False,
        "error_msg": "No connection established",
        "last_updated": None,
        "data": {
            "temperature": 0.0,
            "humidity": 0.0
        }
    },
    "subnode2": {
        "id": "subnode2",
        "name": "Subnode 2 - GPS Tracker",
        "sensors": "LC76G GNSS Module",
        "online": False,
        "sensor_ok": False,
        "error_msg": "No connection established",
        "last_updated": None,
        "data": {
            "latitude": 0.0,
            "longitude": 0.0,
            "altitude": 0.0,
            "speed": 0.0,
            "satellites": 0
        }
    }
}

latest_sensor_data = {
    "temperature": 0.0,
    "humidity": 0.0,
    "latitude": 0.0,
    "longitude": 0.0,
    "altitude": 0.0,
    "speed": 0.0,
    "satellites": 0,
    "dht_ok": False,
    "gnss_ok": False,
    "last_updated": None,
    "online": False,
    "subnodes": list(subnodes_registry.values())
}

class MQTTTelemetryService:
    def __init__(self, db_instance, broker_host="127.0.0.1", broker_port=1883, topics=None):
        self.db = db_instance
        self.broker_host = broker_host
        self.broker_port = broker_port
        self.topics = topics or [
            "smartdoor/subnodes/+/telemetry",
            "smartdoor/subnodes/subnode1/telemetry",
            "smartdoor/subnodes/subnode2/telemetry",
            "smartdoor/sensors/telemetry",
            "esp32/sensors/data"
        ]
        self.client = None
        self.running = False
        self.thread = None

    def start(self):
        self.running = True
        self.thread = threading.Thread(target=self._run_loop, daemon=True)
        self.thread.start()
        logger.info(f"MQTT Telemetry Service thread started (Listening on {self.broker_host}:{self.broker_port})")

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

    def process_telemetry_payload(self, topic, data):
        global latest_sensor_data, subnodes_registry
        now_iso = datetime.now().isoformat()

        # Determine subnode_id from payload or topic
        subnode_id = data.get("node_id", data.get("subnode_id"))
        if not subnode_id:
            if "subnode1" in topic or "dht11" in topic or "temperature_c" in data:
                subnode_id = "subnode1"
            elif "subnode2" in topic or "gnss" in topic or "latitude" in data:
                subnode_id = "subnode2"
            else:
                subnode_id = "subnode1"

        # Update specific subnode record
        if subnode_id not in subnodes_registry:
            subnodes_registry[subnode_id] = {
                "id": subnode_id,
                "name": f"Subnode {len(subnodes_registry) + 1}",
                "sensors": "Generic Sensor Node",
                "online": True,
                "sensor_ok": True,
                "error_msg": None,
                "last_updated": now_iso,
                "data": {}
            }

        target_node = subnodes_registry[subnode_id]
        target_node["online"] = True
        target_node["last_updated"] = now_iso
        target_node["sensor_ok"] = bool(data.get("sensor_ok", data.get("status_ok", True)))
        target_node["error_msg"] = data.get("error", data.get("error_msg", None if target_node["sensor_ok"] else "Sensor anomaly detected"))

        # Extract sensor metrics
        if "temperature_c" in data or "temperature" in data or "dht11" in data:
            dht = data.get("dht11", data)
            temp = float(dht.get("temperature_c", dht.get("temperature", latest_sensor_data["temperature"])))
            hum = float(dht.get("humidity_pct", dht.get("humidity", latest_sensor_data["humidity"])))
            latest_sensor_data["temperature"] = temp
            latest_sensor_data["humidity"] = hum
            latest_sensor_data["dht_ok"] = target_node["sensor_ok"]
            target_node["data"]["temperature"] = temp
            target_node["data"]["humidity"] = hum
            target_node["sensors"] = "DHT11 Temp & Humidity"
            target_node["name"] = "Subnode 1 - Environment"

        if "latitude" in data or "lat" in data or "gnss" in data:
            gnss = data.get("gnss", data)
            lat = float(gnss.get("latitude", gnss.get("lat", latest_sensor_data["latitude"])))
            lng = float(gnss.get("longitude", gnss.get("lng", latest_sensor_data["longitude"])))
            alt = float(gnss.get("altitude_m", gnss.get("alt", latest_sensor_data["altitude"])))
            spd = float(gnss.get("speed_kmph", gnss.get("speed", latest_sensor_data["speed"])))
            sats = int(gnss.get("satellites", gnss.get("sats", latest_sensor_data["satellites"])))
            latest_sensor_data["latitude"] = lat
            latest_sensor_data["longitude"] = lng
            latest_sensor_data["altitude"] = alt
            latest_sensor_data["speed"] = spd
            latest_sensor_data["satellites"] = sats
            latest_sensor_data["gnss_ok"] = target_node["sensor_ok"]
            target_node["data"]["latitude"] = lat
            target_node["data"]["longitude"] = lng
            target_node["data"]["altitude"] = alt
            target_node["data"]["speed"] = spd
            target_node["data"]["satellites"] = sats
            target_node["sensors"] = "LC76G GNSS Module"
            target_node["name"] = "Subnode 2 - GPS Tracker"

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

        logger.info(f"Processed subnode '{subnode_id}' telemetry via MQTT: {data}")
