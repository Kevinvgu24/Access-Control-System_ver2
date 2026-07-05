# Hướng dẫn Triển khai Central Dashboard Server trên Proxmox VE

Tài liệu này hướng dẫn cách chạy Flask Backend API + React Frontend trên server cá nhân Proxmox VE bằng cách sử dụng Docker (Khuyên dùng) hoặc chạy trực tiếp bằng Systemd Service.

---

## LƯU Ý QUAN TRỌNG CHO PROMOX LXC
Nếu bạn chạy hệ thống này bên trong một **LXC Container (Linux Container)** của Proxmox và sử dụng Docker:
1. Bạn phải bật tính năng **Nesting** cho container đó.
2. Trên Web UI của Proxmox, chọn LXC Container -> vào tab **Options** -> chọn **Features** -> chọn **Edit** -> tích chọn **Nesting** -> click OK.
3. Nếu không bật Nesting, Docker daemon bên trong container sẽ không khởi động được.

*Lưu ý: Không cần passthrough GPU hay NPU PCIe từ Proxmox host vào LXC, vì tiến trình trích xuất embedding bằng NPU và camera pipeline chỉ chạy trực tiếp trên thiết bị biên (ví dụ: Raspberry Pi 5).*

---

## PHƯƠNG ÁN 1: TRIỂN KHAI BẰNG DOCKER (KHUYÊN DÙNG)

Sử dụng Docker giúp đóng gói toàn bộ môi trường (NodeJS để build React, Python để chạy Flask) và tự động khôi phục khi khởi động lại server.

### Bước 1: Cài đặt Docker & Docker Compose trên LXC/VM
Đăng nhập vào LXC hoặc VM qua SSH/Console và chạy lệnh:
```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
```

### Bước 2: Sao chép mã nguồn vào server
Nhân bản repository của bạn vào thư mục trên server (ví dụ: `/opt/smart-door`):
```bash
git clone <your-repo-url> /opt/smart-door
cd /opt/smart-door
```

### Bước 3: Build và khởi chạy container
Chạy lệnh dưới đây để bắt đầu tự động tải image, cài đặt thư viện và build giao diện:
```bash
docker compose up --build -d
```

### Bước 4: Kiểm tra hoạt động
1. Truy cập qua trình duyệt: `http://<IP-LXC-HOAC-VM>:5000`
2. Tài khoản quản trị mặc định:
   - **Email**: `dawnnkevin9@gmail.com`
   - **Mật khẩu**: `admin123`
3. Cơ sở dữ liệu SQLite sẽ tự động tạo và lưu trữ cố định tại thư mục `./database/smart_door.db` trên máy host (được mount thông qua volume).

---

## PHƯƠNG ÁN 2: TRIỂN KHAI TRỰC TIẾP (SYSTEMD SERVICE)

Nếu bạn không muốn sử dụng Docker, bạn có thể thiết lập thủ công:

### Bước 1: Cài đặt NodeJS, Python 3 và pip
```bash
# Cài đặt NodeJS (để build React)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs python3 python3-pip python3-venv python3-numpy
```

### Bước 2: Build giao diện React
```bash
cd web_app
npm install
npm run build
cd ..
```

### Bước 3: Cài đặt thư viện Python cho Backend
```bash
# Cài đặt các package cần thiết cho Flask
pip3 install flask flask-cors numpy --break-system-packages # Hoặc dùng virtualenv
```

### Bước 4: Cấu hình Systemd Service để chạy nền
Tạo file cấu hình service tại `/etc/systemd/system/smart-door.service`:
```ini
[Unit]
Description=Smart Door Access Control Central Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/smart-door
ExecStart=/usr/bin/python3 src/Newest_Version/api_server.py
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Sau đó kích hoạt và khởi chạy service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable smart-door.service
sudo systemctl start smart-door.service
```

---

## KẾT NỐI EDGE DEVICE (RASPBERRY PI 5) VỀ SERVER

Để các thiết bị Raspberry Pi 5 ở cửa kết nối và đồng bộ dữ liệu với máy chủ trung tâm:
1. Đăng nhập vào Raspberry Pi 5.
2. Cấu hình biến môi trường `SERVER_URL` trỏ về IP của Proxmox container:
   ```bash
   export SERVER_URL="http://<IP-LXC-HOAC-VM>:5000"
   ```
3. Khởi chạy tiến trình sync client:
   ```bash
   python3 src/Newest_Version/local_sync_client.py
   ```
   Tiến trình này sẽ tự động tải danh sách người dùng mới từ máy chủ về Pi, trích xuất đặc trưng sinh trắc học trên NPU Hailo của Pi, upload vector ngược lại server, đồng thời gửi lịch sử mở cửa và nhiệt độ hệ thống về Server Dashboard theo thời gian thực.
