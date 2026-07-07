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

echo "========================================================="
echo "   STARTING ACCESS CONTROL MONITOR & C++ SYNC SERVICES   "
echo "   Server URL: $SERVER_URL"
echo "========================================================="

# Set paths and model configurations
export YOLO_HEF="/home/kevinvgu/Access-Control-System_ver2/models/yolo26_landmark.hef"
export ARCFACE_HEF="/home/kevinvgu/Access-Control-System_ver2/models/arcface_mobilefacenet.hef"
export LBF_MODEL="/home/kevinvgu/Access-Control-System_ver2/src/Newest_Version/lbfmodel.yaml"
export DB_DIR="/home/kevinvgu/Access-Control-System_ver2/database"
export DB_PATH="/home/kevinvgu/Access-Control-System_ver2/database/smart_door.db"
export REGISTER_SCRIPT="/home/kevinvgu/Access-Control-System_ver2/src/Newest_Version/register.py"

# 1. Start the C++ local sync client in the background
echo "[*] Starting C++ Sync Client..."
/home/kevinvgu/Access-Control-System_ver2/src/Native_Tappas_CPP/build/local_sync_client > sync_client.log 2>&1 &
SYNC_PID=$!
echo "[+] C++ Sync Client started with PID: $SYNC_PID (Logs saved to sync_client.log)"

# 2. Start the C++ directory watcher in the background
echo "[*] Starting C++ Auto Sync Watcher..."
/home/kevinvgu/Access-Control-System_ver2/src/Native_Tappas_CPP/build/auto_sync_watcher > sync_watcher.log 2>&1 &
WATCHER_PID=$!
echo "[+] C++ Auto Sync Watcher started with PID: $WATCHER_PID (Logs saved to sync_watcher.log)"

# Handle cleanup of background processes on exit
cleanup() {
    echo ""
    echo "[*] Stopping background C++ services..."
    kill $SYNC_PID $WATCHER_PID 2>/dev/null
    exit 0
}
trap cleanup SIGINT SIGTERM EXIT

# 3. Start the touchscreen monitor app in the foreground
python3 src/monitor_display/interface_monitor.py \
  --yolo_hef /home/kevinvgu/Access-Control-System_ver2/models/yolo26_landmark.hef \
  --arcface_hef /home/kevinvgu/Access-Control-System_ver2/models/arcface_mobilefacenet.hef \
  --db_dir /home/kevinvgu/Access-Control-System_ver2/database \
  --lbf_model /home/kevinvgu/Access-Control-System_ver2/src/Newest_Version/lbfmodel.yaml \
  --cam_source 0 \
  --use_ir \
  --ir_source libcamerasrc
