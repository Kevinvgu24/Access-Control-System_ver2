#!/bin/bash

# Navigate to the workspace directory
cd /home/kevinvgu/Access-Control-System_ver2

# Check if hailo_env is active, if not activate it
if [ -z "$VIRTUAL_ENV" ]; then
    echo "[*] Activating hailo_env virtual environment..."
    source /home/kevinvgu/hailo_env/bin/activate
fi

# Set PYTHONPATH and disable hailort logger to prevent log writing/memory bloat
export PYTHONPATH="/home/kevinvgu/hailo_env/lib/python3.13/site-packages:/usr/lib/python3/dist-packages:$PYTHONPATH"
export HAILORT_LOGGER_PATH=NONE
export HAILORT_CONSOLE_LOGGER_LEVEL=critical

# Set default SERVER_URL if not set
export SERVER_URL=${SERVER_URL:-"http://192.168.1.244:5000"}

# Read LAB_ID and NODE_ID from lab_config.json if available to sync telemetry correctly with Web App
if [ -f "src/lab_config.json" ]; then
    DETECTED_LAB=$(python3 -c "import json; print(json.load(open('src/lab_config.json')).get('lab_id', 'default-lab'))" 2>/dev/null)
    DETECTED_NODE=$(python3 -c "import json; print(json.load(open('src/lab_config.json')).get('node_id', 'default-node'))" 2>/dev/null)
    if [ -n "$DETECTED_LAB" ]; then export LAB_ID="$DETECTED_LAB"; fi
    if [ -n "$DETECTED_NODE" ]; then export NODE_ID="$DETECTED_NODE"; fi
fi

export DB_PATH="/home/kevinvgu/Access-Control-System_ver2/database/smart_door.db"
export LAB_ID=${LAB_ID:-"default-lab"}
export NODE_ID=${NODE_ID:-"default-node"}

echo "========================================================="
echo "   STARTING ACCESS CONTROL MONITOR & SYNC CLIENT         "
echo "   Server URL: $SERVER_URL"
echo "   Target LAB: $LAB_ID | Node: $NODE_ID"
echo "========================================================="

# 1. Start the local sync client in the background, redirect logs to sync_client.log
echo "[*] Starting Sync Client in background..."
./src/Native_Tappas_CPP/build/local_sync_client > sync_client.log 2>&1 &
SYNC_PID=$!
echo "[+] Sync Client started with PID: $SYNC_PID (Logs saved to sync_client.log)"

# Handle cleanup of background process on exit
cleanup() {
    echo ""
    echo "[*] Stopping background Sync Client..."
    kill $SYNC_PID 2>/dev/null
    exit 0
}
trap cleanup SIGINT SIGTERM EXIT

# 2. Start the touchscreen monitor app in the foreground
python3 src/monitor_display/interface_monitor.py \
  --yolo_hef /home/kevinvgu/Access-Control-System_ver2/models/yolo26_landmark.hef \
  --arcface_hef /home/kevinvgu/Access-Control-System_ver2/models/arcface_mobilefacenet.hef \
  --db_dir /home/kevinvgu/Access-Control-System_ver2/database \
  --lbf_model /home/kevinvgu/Access-Control-System_ver2/src/Newest_Version/lbfmodel.yaml \
  --cam_source 0 \
  --use_ir

