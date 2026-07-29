# MQTT Sensor Subsystem & Web-App Integration

Tài liệu này tổng hợp toàn bộ các thành phần mã nguồn liên quan đến hệ thống Cảm biến MQTT, bao gồm firmware ESP32, mã nguồn xử lý Backend (Python/Flask/MQTT), Cơ sở dữ liệu SQLite, và Giao diện người dùng Web-App (React/TypeScript).

---

## 📁 Cấu trúc thư mục `MQTT_sensor/`

```
MQTT_sensor/
├── ESP1_DHT11_Transmitter.cpp    # Firmware ESP32 #1: Đọc cảm biến Nhiệt độ & Độ ẩm DHT11
├── ESP2_LC76G_Receiver.cpp       # Firmware ESP32 #2: Thu nhận dữ liệu GPS GNSS LC76G
├── Sensor_Connection_Guide.md     # Tài liệu giải thích chi tiết cơ chế hoạt động & kết nối
├── backend/                       # Mã nguồn xử lý Backend & API
│   ├── mqtt_service.py           # Dịch vụ MQTT Client: Xử lý telemetry, tự động dọn hàng chờ, ghép nối
│   ├── api_server.py             # Flask REST API Server: Cung cấp API sensors, export CSV, approve/reject
│   └── database.py               # Thao tác SQLite DB: Lưu trữ cấu hình subnodes, lịch sử telemetry
└── web_app/                       # Mã nguồn Giao diện Người dùng Web-App
    └── SensorTelemetryWidget.tsx # Widget giao diện React hiển thị số liệu cảm biến, bản đồ GPS, modal ghép nối
```

---

## 🚀 Tóm tắt các thành phần chính

### 1. Firmware ESP32 (Phần cứng)
- **`ESP1_DHT11_Transmitter.cpp`**: Mã nguồn nạp cho ESP32 kết nối cảm biến DHT11. Định kỳ 2.5 giây đóng gói JSON (nhiệt độ, độ ẩm, trạng thái) và phát qua MQTT Topic `smartdoor/{LAB_CODE}/sensors/dht11`.
- **`ESP2_LC76G_Receiver.cpp`**: Mã nguồn nạp cho ESP32 kết nối module GPS LC76G qua UART (HardwareSerial 2). Đóng gói dữ liệu tọa độ (Latitude, Longitude), độ cao, tốc độ, số vệ tinh và phát qua MQTT Topic `smartdoor/{LAB_CODE}/sensors/gps`.

### 2. Backend Service (`backend/`)
- **`mqtt_service.py`**:
  - Lắng nghe tin nhắn từ MQTT Broker (EMQX).
  - Phân loại nút đã được Phê duyệt (Approve) và nút chưa phê duyệt (`pending_subnodes`).
  - Watchdog tự động loại bỏ các nút chờ ghép nối ngắt kết nối/mất nguồn sau 15 giây.
  - Quản lý danh sách đen (`rejected_subnodes`) ngăn việc nạp lại nút bị từ chối.
- **`api_server.py`**:
  - API GET `/api/labs/<lab_id>/sensors`: Trả về dữ liệu telemetry thời gian thực và danh sách nút chờ ghép nối.
  - API POST `/api/labs/<lab_id>/subnodes/approve`: Phê duyệt nút cảm biến mới (chống trùng lặp chéo giữa các phòng lab).
  - API POST `/api/labs/<lab_id>/subnodes/reject`: Từ chối nút ghép nối.
  - API GET `/api/labs/<lab_id>/sensors/export`: Tải xuống file CSV chứa dữ liệu lịch sử các cảm biến.
- **`database.py`**:
  - Bảng `subnodes`: Lưu thông tin cấu hình các nút cảm biến đã được cấp phép.
  - Bảng `environment_telemetry`: Lưu lịch sử dữ liệu môi trường (nhiệt độ, độ ẩm, GPS...).
  - Bảng `node_telemetry_history`: Lưu lịch sử số liệu chi tiết từng nút.

### 3. Giao diện Web-App (`web_app/`)
- **`SensorTelemetryWidget.tsx`**:
  - Hiển thị trực quan các thẻ chỉ số (Nhiệt độ, Độ ẩm, Tọa độ GPS, Tốc độ, Số vệ tinh).
  - Tích hợp Bản đồ vệ tinh thời gian thực dựa trên tọa độ GPS thu thập từ module LC76G.
  - Nút **Discover Devices** hiển thị Badge thông báo nút mới và mở Modal hàng chờ ghép nối (`Pending Pairing Queue`) có thanh cuộn mượt mà.
  - Nút **Export CSV** hỗ trợ tải về file báo cáo dữ liệu định dạng CSV.
