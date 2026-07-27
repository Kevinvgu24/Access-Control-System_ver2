Server Deployment Script:

# 1. Di chuyển vào thư mục dự án trên Server
cd /opt/smart-door

# 2. Sao lưu database hiện tại sang thư mục tạm để tránh mất dữ liệu người dùng
cp database/smart_door.db /tmp/smart_door.db.bak 2>/dev/null || true

# 3. Phục hồi tạm thời file database để Git cho phép pull mà không bị xung đột
git checkout -- database/smart_door.db 2>/dev/null || true

# 4. Kéo toàn bộ code mới từ GitHub về
git pull origin main

# 5. Khôi phục lại file database người dùng từ thư mục tạm
cp /tmp/smart_door.db.bak database/smart_door.db 2>/dev/null || true

# 6. Tắt Docker containers cũ
docker compose down

# 7. Khởi chạy lại Docker bằng cấu hình và mã nguồn mới nhất
docker compose up --build -d

# 8. Xóa triệt để các Image cũ, Layer thừa và Cache build Docker để tránh gây đầy dung lượng ổ cứng
docker image prune -af
docker builder prune -af
