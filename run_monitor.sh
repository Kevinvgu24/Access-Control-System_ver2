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

echo "========================================================="
echo "   STARTING TOUCHSCREEN ACCESS CONTROL MONITOR APP       "
echo "========================================================="

python3 src/monitor_display/interface_monitor.py \
  --yolo_hef /home/kevinvgu/Access-Control-System_ver2/models/yolo26_landmark.hef \
  --arcface_hef /home/kevinvgu/Access-Control-System_ver2/models/arcface_mobilefacenet.hef \
  --db_dir /home/kevinvgu/Access-Control-System_ver2/database \
  --lbf_model /home/kevinvgu/Access-Control-System_ver2/src/Newest_Version/lbfmodel.yaml \
  --cam_source 0 \
  --use_ir \
  --ir_source libcamerasrc

