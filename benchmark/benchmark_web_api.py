#!/usr/bin/env python3
"""
Web API & Streaming Concurrency Load Benchmark Tool
Evaluates API throughput (Requests/sec), latency percentiles (P50, P95, P99),
and failure rates under concurrent user load.
"""

import time
import sys
import argparse
import json
import concurrent.futures
import urllib.request
import urllib.error
import numpy as np

def send_request(url, timeout=5.0):
    """Sends a single HTTP GET request and returns (latency_ms, status_code)."""
    t0 = time.time()
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'BenchmarkClient/1.0'})
        with urllib.request.urlopen(req, timeout=timeout) as response:
            _ = response.read()
            latency_ms = (time.time() - t0) * 1000.0
            return latency_ms, response.status
    except urllib.error.HTTPError as e:
        latency_ms = (time.time() - t0) * 1000.0
        return latency_ms, e.code
    except Exception:
        latency_ms = (time.time() - t0) * 1000.0
        return latency_ms, 0

def run_api_load_benchmark(target_url, total_requests=1000, concurrency=10, timeout=5.0, output_json="benchmark_web_results.json"):
    print("=" * 65)
    print(f" Web API Load Benchmark")
    print(f" Target URL     : {target_url}")
    print(f" Total Requests : {total_requests}")
    print(f" Concurrency    : {concurrency} workers")
    print("=" * 65)

    latencies = []
    status_codes = {}
    
    start_time = time.time()
    
    with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as executor:
        futures = [executor.submit(send_request, target_url, timeout) for _ in range(total_requests)]
        
        completed = 0
        for future in concurrent.futures.as_completed(futures):
            latency, code = future.result()
            latencies.append(latency)
            status_codes[code] = status_codes.get(code, 0) + 1
            completed += 1
            if completed % (max(1, total_requests // 10)) == 0:
                print(f" Progress: {completed}/{total_requests} requests finished...")

    total_time = time.time() - start_time
    rps = total_requests / total_time if total_time > 0 else 0

    lat_arr = np.array(latencies)
    success_count = status_codes.get(200, 0)
    success_rate = (success_count / total_requests) * 100.0

    results = {
        "target_url": target_url,
        "total_requests": total_requests,
        "concurrency": concurrency,
        "total_duration_sec": round(total_time, 2),
        "requests_per_second": round(rps, 2),
        "success_rate_percent": round(success_rate, 2),
        "status_code_distribution": status_codes,
        "latency_ms": {
            "mean": round(float(np.mean(lat_arr)), 2),
            "std": round(float(np.std(lat_arr)), 2),
            "min": round(float(np.min(lat_arr)), 2),
            "max": round(float(np.max(lat_arr)), 2),
            "p50": round(float(np.percentile(lat_arr, 50)), 2),
            "p95": round(float(np.percentile(lat_arr, 95)), 2),
            "p99": round(float(np.percentile(lat_arr, 99)), 2)
        }
    }

    print("\n" + "=" * 65)
    print(" API LOAD BENCHMARK RESULTS")
    print("=" * 65)
    print(f" Total Duration   : {results['total_duration_sec']} seconds")
    print(f" Throughput (RPS) : {results['requests_per_second']} req/sec")
    print(f" Success Rate     : {results['success_rate_percent']}% ({success_count}/{total_requests})")
    print(f" Latency Mean     : {results['latency_ms']['mean']} ms")
    print(f" Latency P50      : {results['latency_ms']['p50']} ms")
    print(f" Latency P95      : {results['latency_ms']['p95']} ms")
    print(f" Latency P99      : {results['latency_ms']['p99']} ms")
    print(f" Status Codes     : {status_codes}")
    print("=" * 65)

    with open(output_json, "w") as f:
        json.dump(results, f, indent=2)
    print(f"Results saved to '{output_json}'")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Web API Load & Concurrency Benchmark")
    parser.add_argument("--url", type=str, default="http://127.0.0.1:5000/api/status", help="Target API URL")
    parser.add_argument("--requests", type=int, default=500, help="Total requests to send (default: 500)")
    parser.add_argument("--concurrency", type=int, default=10, help="Concurrent threads (default: 10)")
    parser.add_argument("--output", type=str, default="benchmark_web_results.json", help="Output JSON path")
    args = parser.parse_args()

    run_api_load_benchmark(args.url, args.requests, args.concurrency, output_json=args.output)
