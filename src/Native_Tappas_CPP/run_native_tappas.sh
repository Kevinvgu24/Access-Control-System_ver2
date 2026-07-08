#!/bin/bash

# 1. Navigate to the working directory
cd /home/kevinvgu/Access-Control-System_ver2/src/Native_Tappas_CPP/

echo "============================================="
echo " COMPILING C++ TAPPAS POST-PROCESSING (YOLOv8-Face)"
echo "============================================="

# Create build directory and compile
mkdir -p build
cd build
cmake ..
make -j$(nproc)

if [ $? -ne 0 ]; then
    echo "[ERROR] C++ Compilation failed!"
    exit 1
fi

echo "-> Compilation successful: build/libyolo26_landmark_post.so"
cd ..

# 2. Activate hailo_env virtual environment and export PYTHONPATH
source /home/kevinvgu/hailo_env/bin/activate
export PYTHONPATH="/home/kevinvgu/hailo_env/lib/python3.13/site-packages:/usr/lib/python3/dist-packages"

# 3. Enable HailoRT service sharing
export HAILORT_USE_SERVICE=1

echo "============================================="
echo " STARTING NATIVE C++ TAPPAS PIPELINE"
echo "============================================="

# Run the pipeline with default camera source in headless mode
python3 main_native_tappas.py --source 0 --headless
