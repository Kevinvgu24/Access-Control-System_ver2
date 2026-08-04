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
# 6. Chỉ Rebuild và Cập nhật duy nhất container Web-App (Cực nhanh, không ảnh hưởng AI & Qdrant)
docker compose up -d --build smart-door-server
# 7. Dọn dẹp cache thừa
docker image prune -f





# 1. Thêm tất cả các file đã chỉnh sửa vào staging
git add .

# 2. Tạo commit ghi nhận thay đổi
git commit -m "Translate Vietnamese UI, API messages, CLI tools and DB logs to English"

# 3. Đẩy code lên nhánh main trên GitHub
git push origin main

