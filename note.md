Server:
# 1. Sao lưu database hiện tại sang thư mục tạm để tránh mất dữ liệu người dùng
cp database/smart_door.db /tmp/smart_door.db.bak

# 2. Xóa thay đổi tạm thời của file database để Git cho phép cập nhật
git checkout -- database/smart_door.db

# 3. Kéo toàn bộ code và cấu hình Qdrant mới từ Github về
git pull origin main

# 4. Khôi phục lại file database cũ từ thư mục tạm
cp /tmp/smart_door.db.bak database/smart_door.db

# 5. Tắt Docker cũ
docker compose down

# 6. Khởi động lại Docker bằng cấu hình mới (sẽ tải qdrant-client và chạy Qdrant)
docker compose up --build -d
