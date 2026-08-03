# Benchmark Suite - Smart Lab Access Control System ver 2

Bộ công cụ kiểm thử hiệu năng tự động (Automation Benchmark Suite) cho hệ thống Quản lý Phòng Lab chạy trên **Raspberry Pi 5 + NPU Hailo-8L**.

---

## 📁 Cấu Trúc Các Script

1. **`benchmark_vector_search.cpp`**: Script C++ microbenchmark đo tốc độ tìm kiếm vector 512-D trên C++ Matcher (`libdb_matcher_post.so`) với quy mô $N = 100 \dots 50.000$ mẫu.
2. **`benchmark_system_resources.py`**: Script Python giám sát CPU %, RAM RSS (MB), Nhiệt độ CPU/NPU và tính toán tốc độ rò rỉ bộ nhớ (Memory Leak Rate MB/giờ).
3. **`benchmark_web_api.py`**: Script Python kiểm thử khả năng chịu tải của Web API Server (RPS, Latency P50/P95/P99, Concurrency).
4. **`run_all_benchmarks.py`**: Script điều phối trung tâm - tự động biên dịch C++, thực thi các bài test và tổng hợp báo cáo kết quả ra file `benchmark_report.md` & `benchmark_vector_results.json`.

---

## 🚀 Hướng Dẫn Sử Dụng

### 1. Cài đặt thư viện phụ thuộc (nếu chưa có)

```bash
pip install psutil numpy
```

### 2. Chạy Toàn Bộ Benchmark Suite (Khuyên Dùng)

Chạy script tổng hợp để tự động thực thi và tạo báo cáo:

```bash
python3 benchmark/run_all_benchmarks.py
```

### 3. Chạy Riêng Lẻ Từng Bài Benchmark

* **Đo tốc độ C++ Vector Search ($N=100 \dots 50.000$)**:
  ```bash
  g++ -O3 -std=c++17 benchmark/benchmark_vector_search.cpp -o benchmark/benchmark_vector_search
  ./benchmark/benchmark_vector_search
  ```

* **Đo tài nguyên hệ thống & Rò rỉ bộ nhớ trong 60 giây (hoặc 24 giờ)**:
  ```bash
  python3 benchmark/benchmark_system_resources.py --duration 60 --interval 1.0
  ```

* **Đo chịu tải Web API Server**:
  ```bash
  python3 benchmark/benchmark_web_api.py --url http://127.0.0.1:5000/api/status --requests 500 --concurrency 10
  ```

---

## 📊 Kết Quả Đầu Ra

Sau khi chạy `run_all_benchmarks.py`, kết quả sẽ được tổng hợp tự động vào:
* **`benchmark/benchmark_report.md`**: Báo cáo Markdown dạng bảng kèm trạng thái `Pass / Warn / Fail`.
* **`benchmark/benchmark_vector_results.json`**: Dữ liệu JSON chi tiết cho C++ Vector search.
* **`benchmark/benchmark_system_results.json`**: Dữ liệu JSON chi tiết về CPU, RAM, Nhiệt độ.
* **`benchmark/benchmark_web_results.json`**: Dữ liệu JSON chi tiết về Web API RPS & Latency.
