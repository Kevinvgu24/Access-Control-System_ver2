# Báo Cáo Khắc Phục Lỗi GStreamer Camera Stream & Nhận Diện Khuôn Mặt
**Ngày lập báo cáo:** 29/07/2026

Tài liệu này ghi lại toàn bộ quá trình tìm kiếm nguyên nhân và khắc phục các lỗi liên quan đến việc luồng video không hiển thị và hệ thống nhận diện khuôn mặt không hoạt động trên Raspberry Pi 5.

---

## 🛑 Vấn Đề 1: Màn hình đen, luồng camera bị lỗi `not-negotiated (-4)`
**Tình trạng:** Khi chạy hệ thống, pipeline AI vẫn khởi động bình thường nhưng màn hình stream camera đen thui. GStreamer văng lỗi `streaming stopped, reason not-negotiated (-4)`.

**Nguyên nhân gốc rễ:**
- Script khởi chạy `run_monitor.sh` được cấu hình cứng với tham số `--cam_source libcamerasrc:1`.
- Plugin `libcamerasrc` của GStreamer được thiết kế đặc thù cho các cụm camera kết nối qua cổng cáp dẹt CSI (như Pi Camera). Khi người dùng cắm USB Camera (chuẩn UVC), `libcamerasrc` vẫn cố gắng đọc dữ liệu theo định dạng bộ nhớ RAW của libcamera, dẫn đến lỗi bất đồng bộ định dạng (format negotiation).

**Cách khắc phục:**
1. **Refactor cấu trúc nhận diện nguồn vào (`app.py`):** Viết lại hoàn toàn logic ở hàm `run()`. Nếu người dùng yêu cầu `libcamerasrc` nhưng hệ thống (thông qua lệnh `v4l2-ctl`) phát hiện đó là camera USB/UVC, pipeline sẽ **tự động chuyển hướng (redirect)** sang dùng `v4l2src` và tự động tìm format chuẩn (`YUY2` hoặc `MJPG`) của USB đó.
2. **Cập nhật Script khởi chạy:** Đổi tham số trong `run_monitor.sh` từ `--cam_source libcamerasrc:1` thành `--cam_source 0` để hệ thống tự động tìm camera khả dụng một cách ổn định nhất.

---

## 🛑 Vấn Đề 2: Khung hình hiển thị bình thường nhưng không có khung nhận diện
**Tình trạng:** Sau khi luồng camera chạy mượt mà, lỗi mới xuất hiện: Giao diện hoàn toàn không có bounding box màu xanh/đỏ, không hiện tên người, và hệ thống cửa không nhận được bất kỳ tín hiệu xác thực nào.

**Nguyên nhân gốc rễ:**
Đây là sự kết hợp của 2 lỗi lập trình sâu bên trong Probe của GStreamer:
1. **Giới hạn bộ nhớ sai lầm (Memory Address Bound):**
   - Để vẽ được đồ họa trực tiếp lên bộ nhớ video tốc độ cao (Zero-Copy) bằng Python/OpenCV, hệ thống dùng hàm `_gst_buf_ptr()` để ép kiểu con trỏ C (C-pointer).
   - Hàm này có một đoạn "Sanity Check" để tránh lấy nhầm địa chỉ rác, giới hạn địa chỉ phải nằm trong khoảng `4KB < address < 256GB (0x4000000000)`.
   - **Thực tế:** Trên kiến trúc AArch64 (như Pi 5), địa chỉ user-space (vùng nhớ heap) sử dụng 48-bit nên địa chỉ thường vọt lên mức rất cao (ví dụ: `0x7faaffaa...`), cao hơn mức 256GB. Điều này khiến `_gst_buf_ptr()` luôn hiểu nhầm là lỗi và trả về `None`.
2. **Logic nhận diện bị phụ thuộc logic đồ họa (Coupled Logic):**
   - Trong hàm `on_new_frame_probe`, khối lệnh gửi sự kiện nhận diện về UI (cập nhật danh sách người, tín hiệu mở cửa) lại được viết **bên trong** khối lệnh vẽ đồ họa (`if success:` sau khi map bộ nhớ).
   - Vì con trỏ trả về `None`, lệnh vẽ thất bại (bị skip), dẫn đến tín hiệu nhận diện cũng bị "chôn vùi" luôn, UI không bao giờ nhận được dữ liệu khuôn mặt.

**Cách khắc phục:**
1. **Mở rộng giới hạn bộ nhớ (`app.py`):** Xóa bỏ chặn trên 256GB trong hàm `_gst_buf_ptr()`. Chỉ giữ lại chặn dưới `> 0x1000` (tránh Null Pointer / Kernel Space). Ngay lập tức ctypes đọc được vùng nhớ đúng và OpenCV có thể vẽ lại HUD siêu nhanh.
2. **Tách biệt Logic (Decoupling) (`app.py`):** Viết lại hàm `on_new_frame_probe`. 
   - Đưa quá trình trích xuất Detections (tọa độ hộp, landmarks, tên nhãn, class_id) và bắn sự kiện `recognition_callback` lên đầu vòng lặp.
   - Quá trình "Map bộ nhớ vẽ đồ họa" được để ra phía sau. Việc vẽ có thể thành công hoặc thất bại, nhưng tiến trình gửi nhận diện về Core UI sẽ luôn được đảm bảo thực thi 100%.

---
### 📌 Kết Luận:
Hệ thống hiện tại đã xử lý được hoàn toàn các vấn đề liên đới của GStreamer và tương tác bộ nhớ C/Python trên Pi 5. Thiết kế mới giúp Code chống chịu được với mọi trường hợp cắm rút camera hoặc bảo vệ vùng nhớ của hệ điều hành.
