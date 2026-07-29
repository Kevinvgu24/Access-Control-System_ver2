# MQTT Sensor Subsystem & Web-App Integration

> **🔒 CHÚ THÍCH BẢO MẬT & QUYỀN RIÊNG TƯ (SECURITY & PRIVACY NOTICE)**
> Tất cả các đoạn mã nguồn không liên quan đến hệ thống cảm biến (bao gồm: Thuật toán nhận diện khuôn mặt, Vectơ nhúng sinh trắc học, Mã PIN xác thực, Quản lý tài khoản người dùng, Nhật ký ra vào cửa và Điều khiển khóa cửa tự động) **đã được lọc và ẩn đi (Redacted)** trong thư mục `MQTT_sensor/` vì lý do bảo mật. 
> 
> Thư mục này **CHỈ GIỮ LẠI TRỌN VẸN 100% MÃ NGUỒN LIÊN QUAN ĐẾN PHẦN NHẬN DIỆN & GHÉP NỐI CẢM BIẾN MQTT**.

---

## 📁 Cấu trúc thư mục `MQTT_sensor/`

```
MQTT_sensor/
├── README.md                      # Tài liệu mô tả chi tiết & chú thích bảo mật
├── ESP1_DHT11_Transmitter.cpp    # Firmware ESP32 #1: Đọc cảm biến Nhiệt độ & Độ ẩm DHT11
├── ESP2_LC76G_Receiver.cpp       # Firmware ESP32 #2: Thu nhận dữ liệu GPS GNSS LC76G
├── Sensor_Connection_Guide.md     # Tài liệu hướng dẫn & giải thích chi tiết cơ chế hoạt động
│
├── backend/                       # Mã nguồn xử lý Backend API & MQTT (Đã lọc bỏ bảo mật)
│   ├── mqtt_service.py           # Dịch vụ MQTT Client: Xử lý telemetry, tự động dọn hàng chờ, ghép nối
│   ├── api_server.py             # Flask REST API Server: Cung cấp API sensors, export CSV, approve/reject
│   └── database.py               # Thao tác SQLite DB: Lưu trữ cấu hình subnodes, lịch sử telemetry
│
└── web_app/                       # Mã nguồn Giao diện Người dùng Web-App
    └── SensorTelemetryWidget.tsx # Widget giao diện React hiển thị số liệu cảm biến, bản đồ GPS, modal ghép nối
```

---

## 🚀 Các tính năng cảm biến được giữ lại

### 1. Phần cứng ESP32 Firmware
- **`ESP1_DHT11_Transmitter.cpp`**: Thu thập dữ liệu Nhiệt độ & Độ ẩm DHT11, đóng gói JSON và gửi qua MQTT Broker.
- **`ESP2_LC76G_Receiver.cpp`**: Thu thập tọa độ GPS (Vĩ độ, Kinh độ, Độ cao, Tốc độ, Vệ tinh) từ module LC76G và gửi qua MQTT Topic.

### 2. Backend & Database Subsystem (`backend/`)
- **`database.py`**: Khai báo và thao tác trên 3 bảng SQLite dành riêng cho cảm biến:
  - `subnodes`: Lưu thông tin các nút cảm biến đã được Admin ghép nối.
  - `environment_telemetry`: Lưu vết dữ liệu môi trường tổng hợp.
  - `node_telemetry_history`: Lưu vết chi tiết từng nút cảm biến theo thời gian.
- **`mqtt_service.py`**:
  - Tự động nhận diện thiết bị ESP32 mới qua MQTT Topic.
  - Tự động dọn dẹp nút ngắt kết nối/mất điện sau 15 giây.
  - Quản lý danh sách đen (`rejected_subnodes`) tránh nạp lại nút bị từ chối.
- **`api_server.py`**:
  - `GET /api/labs/<lab_id>/sensors`: Lấy dữ liệu telemetry thời gian thực và hàng chờ ghép nối.
  - `POST /api/labs/<lab_id>/subnodes/approve`: Phê duyệt & ghép nối nút cảm biến (chống trùng lặp chéo giữa các lab).
  - `POST /api/labs/<lab_id>/subnodes/reject`: Từ chối ghép nối thiết bị.
  - `GET /api/labs/<lab_id>/sensors/export`: Xuất dữ liệu cảm biến ra file CSV.

### 3. Giao diện Web-App (`web_app/`)
- **`SensorTelemetryWidget.tsx`**: Widget React tích hợp đầy đủ thẻ chỉ số, Bản đồ vệ tinh GPS, Modal phát hiện & ghép nối thiết bị mới có thanh cuộn mượt mà.
