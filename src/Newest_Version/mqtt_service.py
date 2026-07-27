import json
import time
import threading
from datetime import datetime
from logger import get_logger

logger = get_logger("mqtt_service")

# Global in-memory cache for latest telemetry data
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
    "online": False
}

class MQTTTelemetryService:
    def __init__(self, db_instance, broker_host="127.0.0.1", broker_port=1883, topics=None):
        self.db = db_instance
        self.broker_host = broker_host
        self.broker_port = broker_port
        self.topics = topics or [
            "smartdoor/sensors/telemetry",
            "smartdoor/sensors/dht11",
            "smartdoor/sensors/gps",
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
            logger.warning("paho-mqtt library is not installed. MQTT listener will run in mock/poll fallback mode.")
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
                # Support both older and newer paho-mqtt Client API initialization
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
        global latest_sensor_data
        now_iso = datetime.now().isoformat()

        temp = latest_sensor_data.get("temperature", 0.0)
        hum = latest_sensor_data.get("humidity", 0.0)
        lat = latest_sensor_data.get("latitude", 0.0)
        lng = latest_sensor_data.get("longitude", 0.0)
        alt = latest_sensor_data.get("altitude", 0.0)
        spd = latest_sensor_data.get("speed", 0.0)
        sats = latest_sensor_data.get("satellites", 0)
        dht_ok = latest_sensor_data.get("dht_ok", False)
        gnss_ok = latest_sensor_data.get("gnss_ok", False)

        # Combined telemetry topic format
        if "dht11" in data or "gnss" in data or "temperature_c" in data or "dht11" in topic:
            if "dht11" in data:
                dht = data["dht11"]
                temp = float(dht.get("temperature_c", dht.get("temperature", temp)))
                hum = float(dht.get("humidity_pct", dht.get("humidity", hum)))
                dht_ok = bool(dht.get("sensor_ok", True))
            elif "temperature_c" in data or "temperature" in data:
                temp = float(data.get("temperature_c", data.get("temperature", temp)))
                hum = float(data.get("humidity_pct", data.get("humidity", hum)))
                dht_ok = bool(data.get("sensor_ok", True))

            if "gnss" in data:
                gnss = data["gnss"]
                lat = float(gnss.get("latitude", lat))
                lng = float(gnss.get("longitude", lng))
                alt = float(gnss.get("altitude_m", gnss.get("altitude", alt)))
                spd = float(gnss.get("speed_kmph", gnss.get("speed", spd)))
                sats = int(gnss.get("satellites", sats))
                gnss_ok = bool(gnss.get("location_valid", True))
            elif "latitude" in data or "lat" in data:
                lat = float(data.get("latitude", data.get("lat", lat)))
                lng = float(data.get("longitude", data.get("lng", lng)))
                alt = float(data.get("altitude_m", data.get("alt", alt)))
                spd = float(data.get("speed_kmph", data.get("speed", spd)))
                sats = int(data.get("satellites", data.get("sats", sats)))
                gnss_ok = bool(data.get("location_valid", data.get("valid", True)))

        latest_sensor_data = {
            "temperature": temp,
            "humidity": hum,
            "latitude": lat,
            "longitude": lng,
            "altitude": alt,
            "speed": spd,
            "satellites": sats,
            "dht_ok": dht_ok,
            "gnss_ok": gnss_ok,
            "last_updated": now_iso,
            "online": True
        }

        # Save to database
        if self.db:
            self.db.save_sensor_telemetry(
                temperature=temp,
                humidity=hum,
                latitude=lat,
                longitude=lng,
                altitude=alt,
                speed=spd,
                satellites=sats,
                dht_ok=dht_ok,
                gnss_ok=gnss_ok,
                raw_payload=json.dumps(data)
            )

        logger.info(f"Updated sensor telemetry from MQTT: Temp={temp}°C, Hum={hum}%, Lat={lat}, Lng={lng}, Sats={sats}")
