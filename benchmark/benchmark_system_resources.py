#!/usr/bin/env python3
"""
System Resource & Memory Leak Benchmark Script for Access Control System ver 2
Monitors CPU %, RAM RSS (MB), CPU Temperature, and Hailo NPU Status over time.
Calculates summary statistics and memory drift rate (MB/hour).
"""

import time
import os
import sys
import argparse
import json
import numpy as np

try:
    import psutil
except ImportError:
    sys.exit("Error: 'psutil' package is required. Install via: pip install psutil")

def get_cpu_temp():
    """Returns CPU temperature in Celsius (Raspberry Pi / Linux sysfs)."""
    thermal_paths = [
        "/sys/class/thermal/thermal_zone0/temp",
        "/sys/devices/virtual/thermal/thermal_zone0/temp"
    ]
    for path in thermal_paths:
        if os.path.exists(path):
            try:
                with open(path, "r") as f:
                    temp_raw = float(f.read().strip())
                    return temp_raw / 1000.0 if temp_raw > 1000 else temp_raw
            except Exception:
                pass
    return 0.0

def get_hailo_temp():
    """Returns Hailo-8L NPU temperature if available via sysfs or hailortcli."""
    hailo_thermal_path = "/sys/class/hailo/hailo0/temperature"
    if os.path.exists(hailo_thermal_path):
        try:
            with open(hailo_thermal_path, "r") as f:
                return float(f.read().strip())
        except Exception:
            pass
    return 0.0

def monitor_system(duration_sec=60, sample_interval=1.0, output_json="benchmark_system_results.json"):
    print("=" * 65)
    print(f" System Resource & Memory Leak Monitor ({duration_sec}s duration, {sample_interval}s interval)")
    print("=" * 65)
    
    start_time = time.time()
    end_time = start_time + duration_sec
    
    timestamps = []
    cpu_percents = []
    ram_mb_list = []
    cpu_temps = []
    hailo_temps = []
    
    process = psutil.Process(os.getpid())
    
    try:
        sample_count = 0
        while time.time() < end_time:
            now = time.time()
            elapsed = now - start_time
            
            # System-wide metrics
            cpu_pct = psutil.cpu_percent(interval=None)
            ram_info = psutil.virtual_memory()
            ram_used_mb = ram_info.used / (1024 * 1024)
            cpu_temp = get_cpu_temp()
            hailo_temp = get_hailo_temp()
            
            timestamps.append(round(elapsed, 2))
            cpu_percents.append(cpu_pct)
            ram_mb_list.append(ram_used_mb)
            cpu_temps.append(cpu_temp)
            hailo_temps.append(hailo_temp)
            
            sample_count += 1
            if sample_count % 5 == 0 or sample_interval >= 2.0:
                print(f" [{elapsed:6.1f}s] CPU: {cpu_pct:5.1f}% | RAM: {ram_used_mb:7.1f} MB | CPU Temp: {cpu_temp:4.1f}°C | Hailo Temp: {hailo_temp:4.1f}°C")
            
            time.sleep(sample_interval)
            
    except KeyboardInterrupt:
        print("\nMonitoring stopped early by user.")
    
    actual_duration = time.time() - start_time
    if not timestamps:
        print("No samples collected.")
        return

    # Calculate statistics
    cpu_arr = np.array(cpu_percents)
    ram_arr = np.array(ram_mb_list)
    temp_arr = np.array(cpu_temps)
    
    # Calculate Memory Leak Drift Rate (MB per hour) using linear regression
    if len(timestamps) > 1:
        x = np.array(timestamps)
        slope, _ = np.polyfit(x, ram_arr, 1) # MB per second
        leak_rate_mb_per_hr = slope * 3600.0
    else:
        leak_rate_mb_per_hr = 0.0
        
    results = {
        "duration_seconds": round(actual_duration, 2),
        "total_samples": len(timestamps),
        "cpu_percent": {
            "mean": round(float(np.mean(cpu_arr)), 2),
            "max": round(float(np.max(cpu_arr)), 2),
            "min": round(float(np.min(cpu_arr)), 2),
            "p95": round(float(np.percentile(cpu_arr, 95)), 2)
        },
        "ram_mb": {
            "start": round(float(ram_arr[0]), 2),
            "end": round(float(ram_arr[-1]), 2),
            "mean": round(float(np.mean(ram_arr)), 2),
            "max": round(float(np.max(ram_arr)), 2),
            "min": round(float(np.min(ram_arr)), 2),
            "leak_rate_mb_per_hour": round(float(leak_rate_mb_per_hr), 2)
        },
        "cpu_temperature_celsius": {
            "mean": round(float(np.mean(temp_arr)), 2),
            "max": round(float(np.max(temp_arr)), 2),
            "min": round(float(np.min(temp_arr)), 2)
        }
    }

    print("\n" + "=" * 65)
    print(" SUMMARY STATISTICS")
    print("=" * 65)
    print(f" Total Duration      : {results['duration_seconds']} seconds ({results['total_samples']} samples)")
    print(f" CPU Usage (%)       : Mean = {results['cpu_percent']['mean']}%, Max = {results['cpu_percent']['max']}%, P95 = {results['cpu_percent']['p95']}%")
    print(f" RAM Usage (MB)      : Start = {results['ram_mb']['start']} MB, End = {results['ram_mb']['end']} MB, Max = {results['ram_mb']['max']} MB")
    print(f" Memory Leak Rate    : {results['ram_mb']['leak_rate_mb_per_hour']} MB/hour")
    print(f" CPU Temperature     : Mean = {results['cpu_temperature_celsius']['mean']}°C, Max = {results['cpu_temperature_celsius']['max']}°C")
    print("=" * 65)

    with open(output_json, "w") as f:
        json.dump(results, f, indent=2)
    print(f"Results saved to '{output_json}'")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="System Resource & Memory Leak Benchmark")
    parser.add_argument("--duration", type=int, default=60, help="Test duration in seconds (default: 60)")
    parser.add_argument("--interval", type=float, default=1.0, help="Sampling interval in seconds (default: 1.0)")
    parser.add_argument("--output", type=str, default="benchmark_system_results.json", help="Output JSON path")
    args = parser.parse_args()
    
    monitor_system(args.duration, args.interval, args.output)
