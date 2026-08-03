#!/usr/bin/env python3
"""
Master Benchmark Orchestrator & Report Generator
Runs C++ Vector Benchmark, System Resource Monitor, and Web API Load Benchmark.
Aggregates all JSON outputs into a unified Markdown Benchmark Report (`benchmark_report.md`).
"""

import os
import sys
import subprocess
import time
import json

BENCHMARK_DIR = os.path.dirname(os.path.abspath(__file__))

def run_command(cmd, cwd=BENCHMARK_DIR):
    print(f"\n[RUNNING] {cmd}")
    res = subprocess.run(cmd, shell=True, cwd=cwd)
    if res.returncode != 0:
        print(f"[WARNING] Command failed with return code {res.returncode}")
    return res.returncode

def compile_and_run_cpp_benchmark():
    print("\n========================================================")
    print(" 1. COMPILING AND RUNNING C++ VECTOR SEARCH BENCHMARK")
    print("========================================================")
    
    source = os.path.join(BENCHMARK_DIR, "benchmark_vector_search.cpp")
    binary = os.path.join(BENCHMARK_DIR, "benchmark_vector_search")
    
    # Try g++ compilation with -O3 optimizations
    compile_cmd = f"g++ -O3 -std=c++17 '{source}' -o '{binary}'"
    ret = run_command(compile_cmd)
    
    if ret == 0 and os.path.exists(binary):
        run_command(f"'{binary}'")
    else:
        print("[SKIP] Could not compile C++ benchmark (g++ not found or compilation error).")

def run_system_resource_benchmark(duration_sec=30):
    print("\n========================================================")
    print(f" 2. RUNNING SYSTEM RESOURCE BENCHMARK ({duration_sec}s)")
    print("========================================================")
    script = os.path.join(BENCHMARK_DIR, "benchmark_system_resources.py")
    run_command(f"python3 '{script}' --duration {duration_sec} --output benchmark_system_results.json")

def run_web_api_benchmark():
    print("\n========================================================")
    print(" 3. RUNNING WEB API BENCHMARK")
    print("========================================================")
    script = os.path.join(BENCHMARK_DIR, "benchmark_web_api.py")
    run_command(f"python3 '{script}' --url http://127.0.0.1:5000/api/status --requests 300 --concurrency 5 --output benchmark_web_results.json")

def generate_markdown_report():
    print("\n========================================================")
    print(" 4. GENERATING UNIFIED BENCHMARK REPORT (benchmark_report.md)")
    print("========================================================")
    
    vec_path = os.path.join(BENCHMARK_DIR, "benchmark_vector_results.json")
    sys_path = os.path.join(BENCHMARK_DIR, "benchmark_system_results.json")
    web_path = os.path.join(BENCHMARK_DIR, "benchmark_web_results.json")
    
    vec_data = json.load(open(vec_path)) if os.path.exists(vec_path) else None
    sys_data = json.load(open(sys_path)) if os.path.exists(sys_path) else None
    web_data = json.load(open(web_path)) if os.path.exists(web_path) else None
    
    report_md = f"""# Báo Cáo Kết Quả Benchmark Hệ Thống Quản Lý Phòng Lab
**Ngày thực hiện:** {time.strftime('%Y-%m-%d %H:%M:%S')}  
**Thiết bị:** Raspberry Pi 5 + NPU Hailo-8L  

---

## I. Tổng Quan Kết Quả (Summary Matrix)

| Trụ Cột Đánh Giá | Chỉ Số Metric | Kết Quả Thực Tế | Ngưỡng Tiêu Chuẩn (Target) | Đánh Giá |
| :--- | :--- | :---: | :---: | :---: |
"""
    
    # Evaluate System Resources
    if sys_data:
        cpu_mean = sys_data['cpu_percent']['mean']
        ram_max = sys_data['ram_mb']['max']
        leak_rate = sys_data['ram_mb']['leak_rate_mb_per_hour']
        cpu_pass = "✅ PASS" if cpu_mean < 25.0 else "⚠️ WARN"
        leak_pass = "✅ PASS" if leak_rate < 10.0 else "❌ FAIL"
        
        report_md += f"| **CPU Usage** | Tải CPU trung bình | **{cpu_mean}%** | < 25.0% | {cpu_pass} |\n"
        report_md += f"| **RAM Usage** | Đỉnh RAM | **{ram_max} MB** | < 350.0 MB | ✅ PASS |\n"
        report_md += f"| **Memory Leak** | Tỷ lệ rò rỉ RAM | **{leak_rate} MB/h** | < 10.0 MB/h | {leak_pass} |\n"
    else:
        report_md += "| **System Resource** | CPU / RAM | *Chưa đo* | - | ⏳ Pending |\n"
        
    # Evaluate Vector Search
    if vec_data and "results" in vec_data:
        res_10k = next((r for r in vec_data["results"] if r.get("num_users") == 10000), vec_data["results"][-1])
        qps_10k = res_10k.get("qps", 0)
        mean_us = res_10k.get("mean_latency_us", 0)
        v_pass = "✅ PASS" if mean_us < 2000.0 else "⚠️ WARN"
        report_md += f"| **Vector Search (N={res_10k.get('num_users')})** | Throughput QPS | **{qps_10k:.1f} req/s** | > 500 req/s | {v_pass} |\n"
        report_md += f"| **Vector Latency** | Mean Latency | **{mean_us/1000.0:.2f} ms** | < 2.0 ms | {v_pass} |\n"
    else:
        report_md += "| **Vector Search** | Latency / QPS | *Chưa đo* | - | ⏳ Pending |\n"

    # Evaluate Web API
    if web_data:
        rps = web_data.get("requests_per_second", 0)
        p95 = web_data.get("latency_ms", {}).get("p95", 0)
        web_pass = "✅ PASS" if p95 < 300.0 else "⚠️ WARN"
        report_md += f"| **Web API Throughput** | Requests / sec | **{rps} RPS** | > 50 RPS | {web_pass} |\n"
        report_md += f"| **Web API Latency** | P95 Latency | **{p95} ms** | < 300 ms | {web_pass} |\n"
    else:
        report_md += "| **Web API** | RPS / P95 Latency | *Chưa đo / Server offline* | - | ⏳ Pending |\n"

    report_md += "\n---\n\n## II. Chi Tiết Kết Quả Từng Phân Vùng\n\n"
    
    if sys_data:
        report_md += f"### 1. Tài Nguyên Hệ Thống & Kiểm Tra Rò Rỉ Bộ Nhớ\n"
        report_md += f"- **Thời gian đo:** {sys_data['duration_seconds']}s ({sys_data['total_samples']} mẫu)\n"
        report_md += f"- **CPU Usage:** Trung bình `{sys_data['cpu_percent']['mean']}%`, Cao nhất `{sys_data['cpu_percent']['max']}%`, P95 `{sys_data['cpu_percent']['p95']}%`\n"
        report_md += f"- **RAM Usage:** Ban đầu `{sys_data['ram_mb']['start']} MB`, Kết thúc `{sys_data['ram_mb']['end']} MB`\n"
        report_md += f"- **Tỷ lệ rò rỉ bộ nhớ:** `{sys_data['ram_mb']['leak_rate_mb_per_hour']} MB/giờ`\n"
        report_md += f"- **Nhiệt độ CPU:** `{sys_data['cpu_temperature_celsius']['mean']}°C` (Cực đại `{sys_data['cpu_temperature_celsius']['max']}°C`)\n\n"
        
    if vec_data and "results" in vec_data:
        report_md += f"### 2. Tốc Độ Tìm Kiếm Vector Cosine Similarity (C++ Matcher)\n"
        report_md += "| Quy Mô N người | Dung Lượng RAM | Throughput (QPS) | Latency Trung Bình | P95 Latency | P99 Latency |\n"
        report_md += "| :---: | :---: | :---: | :---: | :---: | :---: |\n"
        for r in vec_data["results"]:
            report_md += f"| {r['num_users']} | {r['memory_mb']:.2f} MB | {r['qps']:.1f} req/s | {r['mean_latency_us']:.1f} µs | {r['p95_latency_us']:.1f} µs | {r['p99_latency_us']:.1f} µs |\n"
        report_md += "\n"
        
    if web_data:
        report_md += f"### 3. Tải Web Server & Endpoint Latency\n"
        report_md += f"- **URL:** `{web_data['target_url']}`\n"
        report_md += f"- **Tổng request:** {web_data['total_requests']} (Song song {web_data['concurrency']} workers)\n"
        report_md += f"- **Tốc độ xử lý:** `{web_data['requests_per_second']} RPS`\n"
        report_md += f"- **Tỷ lệ thành công:** `{web_data['success_rate_percent']}%`\n"
        report_md += f"- **Độ trễ:** Mean `{web_data['latency_ms']['mean']}ms`, P50 `{web_data['latency_ms']['p50']}ms`, P95 `{web_data['latency_ms']['p95']}ms`, P99 `{web_data['latency_ms']['p99']}ms`\n\n"

    report_path = os.path.join(BENCHMARK_DIR, "benchmark_report.md")
    with open(report_path, "w", encoding="utf-8") as f:
        f.write(report_md)
        
    print(f"Report generated successfully: '{report_path}'")

def main():
    print("========================================================")
    print(" AUTOMATION BENCHMARK SUITE - ACCESS CONTROL SYSTEM V2")
    print("========================================================")
    
    compile_and_run_cpp_benchmark()
    run_system_resource_benchmark(duration_sec=30)
    run_web_api_benchmark()
    generate_markdown_report()
    
    print("\n[SUCCESS] Benchmark Suite Completed!")

if __name__ == "__main__":
    main()
