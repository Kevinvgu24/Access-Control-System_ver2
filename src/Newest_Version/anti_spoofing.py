import cv2
import numpy as np
from logger import get_logger

logger = get_logger("anti_spoofing")

class IRLivenessDetector:
    def __init__(self, min_contrast_ratio=1.20, min_blur_var=15.0, max_blur_var=1000.0, max_hotspot_ratio=0.02, min_radial_ratio=1.30):
        self.min_contrast_ratio = min_contrast_ratio
        self.min_blur_var = min_blur_var
        self.max_blur_var = max_blur_var
        self.max_hotspot_ratio = max_hotspot_ratio
        self.min_radial_ratio = min_radial_ratio

    def check_liveness(self, ir_face_crop, landmarks=None):
        """
        Kiểm tra tính sống động nâng cấp dựa trên các đặc tính vật lý 3D và sinh học dưới ánh sáng IR:
        1. Mean Brightness: Loại bỏ màn hình điện thoại hấp thụ hồng ngoại (quá tối).
        2. Specular Hotspot Glare: Loại bỏ phản xạ gương từ kính màn hình/giấy in bóng.
        3. 3D Radial Shading: Loại bỏ ảnh phẳng (không có độ dốc suy giảm ánh sáng từ tâm ra rìa).
        4. Biological Contrast: Độ tương phản hấp thụ đặc trưng giữa nước trong mắt và phản xạ da người.
        5. Texture Edge Frequency (Laplacian): Loại bỏ ảnh moiré màn hình hoặc độ hạt mực giấy in.
        """
        if ir_face_crop is None or ir_face_crop.size == 0:
            logger.warning("IR Liveness: Empty crop received.")
            return False, 0.0, "Empty crop"

        h, w = ir_face_crop.shape[:2]
        total_pixels = h * w

        # ----------------------------------------------------
        # BÀI KIỂM TRA 0: ĐỘ SÁNG TRUNG BÌNH (Smartphone Screen Check)
        # ----------------------------------------------------
        mean_brightness = np.mean(ir_face_crop)
        if mean_brightness < 35.0:
            logger.warning(f"Spoof detected: Mean brightness {mean_brightness:.2f} < 35.0 (Smartphone screen)")
            return False, float(mean_brightness), f"Crop qua toi/Man hinh hap thu IR (brightness: {mean_brightness:.1f})"

        # ----------------------------------------------------
        # BÀI KIỂM TRA 1: PHÁT HIỆN ĐIỂM LÓA GƯƠNG CHỦ ĐỘNG (HOTSPOT)
        # ----------------------------------------------------
        # Tính ngưỡng lóa động thích ứng
        hotspot_threshold = max(240, min(254, int(mean_brightness + 40)))
        _, hotspot_mask = cv2.threshold(ir_face_crop, hotspot_threshold, 255, cv2.THRESH_BINARY)
        hotspot_pixels = cv2.countNonZero(hotspot_mask)
        hotspot_ratio = hotspot_pixels / total_pixels

        # ----------------------------------------------------
        # BÀI KIỂM TRA 2: ĐỘ DỐC ĐỘ SÁNG 3D TRUNG TÂM / CẠNH (3D RADIAL SHADING)
        # ----------------------------------------------------
        # Vùng trung tâm (Center 50% nơi mũi và má phản xạ mạnh nhất)
        inner_h_start, inner_h_end = int(h * 0.25), int(h * 0.75)
        inner_w_start, inner_w_end = int(w * 0.25), int(w * 0.75)
        inner_zone = ir_face_crop[inner_h_start:inner_h_end, inner_w_start:inner_w_end]
        
        # Vùng viền (Outer 15% margin nơi tóc, tai, nền hấp thụ/xa nguồn sáng)
        outer_mask = np.ones((h, w), dtype=np.uint8)
        outer_mask[int(h*0.15):int(h*0.85), int(w*0.15):int(w*0.85)] = 0
        outer_zone_pixels = ir_face_crop[outer_mask == 1]
        
        mean_inner = np.mean(inner_zone) if inner_zone.size > 0 else 1.0
        mean_outer = np.mean(outer_zone_pixels) if outer_zone_pixels.size > 0 else 1.0
        radial_ratio = mean_inner / (mean_outer if mean_outer > 0 else 1.0)

        # ----------------------------------------------------
        # BÀI KIỂM TRA 3: TƯƠNG PHẢN SINH HỌC VÙNG CHÚ Ý (ATTENTION ROI)
        # ----------------------------------------------------
        if landmarks and len(landmarks) == 5:
            try:
                # Lấy tọa độ thực tế của mắt trái và mắt phải
                lex, ley = int(landmarks[0][0] * w), int(landmarks[0][1] * h)
                rex, rey = int(landmarks[1][0] * w), int(landmarks[1][1] * h)
                
                # Crop vùng mắt trái và mắt phải nhỏ (kích thước khoảng 12% chiều rộng khuôn mặt)
                eye_sz = int(w * 0.12)
                left_eye_roi = ir_face_crop[max(0, ley-eye_sz):min(h, ley+eye_sz), max(0, lex-eye_sz):min(w, lex+eye_sz)]
                right_eye_roi = ir_face_crop[max(0, rey-eye_sz):min(h, rey+eye_sz), max(0, rex-eye_sz):min(w, rex+eye_sz)]
                
                # Crop vùng má (giữa mắt và miệng, vùng dưới mắt phải một chút để lấy da sáng)
                skin_sz = int(w * 0.15)
                mx, my = int(landmarks[2][0] * w), int(landmarks[2][1] * h) # Mũi
                skin_roi = ir_face_crop[max(0, my):min(h, my+skin_sz), max(0, mx-skin_sz):min(w, mx+skin_sz)]
                
                if left_eye_roi.size > 0 and right_eye_roi.size > 0 and skin_roi.size > 0:
                    left_sorted = np.sort(left_eye_roi.ravel())
                    right_sorted = np.sort(right_eye_roi.ravel())
                    mean_eye = (np.mean(left_sorted[:int(len(left_sorted)*0.2)]) + 
                                np.mean(right_sorted[:int(len(right_sorted)*0.2)])) / 2.0
                    
                    skin_sorted = np.sort(skin_roi.ravel())
                    mean_skin = np.mean(skin_sorted[-int(len(skin_sorted)*0.2):])
                else:
                    raise ValueError("Fallback to global zones")
            except Exception:
                # Fallback nếu crop bị lỗi ngoài biên
                mean_eye = np.mean(ir_face_crop[0:int(h*0.4), :])
                mean_skin = np.mean(ir_face_crop[int(h*0.6):h, :])
        else:
            # Fallback nếu không có thông tin Landmarks: chia ảnh tĩnh 40% trên (Mắt) và 40% dưới (Da)
            upper_half = ir_face_crop[0:int(h*0.4), :]
            lower_half = ir_face_crop[int(h*0.6):h, :]
            upper_sorted = np.sort(upper_half.ravel())
            lower_sorted = np.sort(lower_half.ravel())
            mean_eye = np.mean(upper_sorted[:int(len(upper_sorted)*0.2)])
            mean_skin = np.mean(lower_sorted[-int(len(lower_sorted)*0.2):])

        if mean_eye == 0:
            mean_eye = 1.0
        contrast_ratio = mean_skin / mean_eye

        # ----------------------------------------------------
        # BÀI KIỂM TRA 4: PHÂN TÍCH KẾT CẤU VI MÔ LAPLACIAN (TEXTURE)
        # ----------------------------------------------------
        laplacian = cv2.Laplacian(ir_face_crop, cv2.CV_64F)
        blur_var = laplacian.var()

        # LOGGING ĐO LƯỜNG THỰC TẾ RA CONSOLE ĐỂ HỖ TRỢ ĐIỀU CHỈNH
        logger.info(
            f"[IR Liveness Diagnostics] "
            f"Mean Brightness: {mean_brightness:.2f} (min: 35.0), "
            f"Hotspot Ratio: {hotspot_ratio:.4f} (limit: {self.max_hotspot_ratio}), "
            f"Radial Ratio: {radial_ratio:.3f} (min: {self.min_radial_ratio}), "
            f"Contrast Ratio: {contrast_ratio:.2f} (min: {self.min_contrast_ratio}), "
            f"Laplacian Variance: {blur_var:.2f} (range: {self.min_blur_var} - {self.max_blur_var})"
        )

        # Đánh giá liveness
        if hotspot_ratio > self.max_hotspot_ratio:
            logger.warning(f"Spoof detected: Hotspot glare ratio {hotspot_ratio:.4f} > {self.max_hotspot_ratio}")
            return False, float(hotspot_ratio), f"Loa man hinh/Giay kinh (ratio: {hotspot_ratio:.3f})"

        if radial_ratio < self.min_radial_ratio:
            logger.warning(f"Spoof detected: Radial ratio {radial_ratio:.3f} < {self.min_radial_ratio}")
            return False, float(radial_ratio), f"Mat phang ko co do sau 3D (radial: {radial_ratio:.2f})"

        if contrast_ratio < self.min_contrast_ratio:
            logger.warning(f"Spoof detected: Contrast ratio {contrast_ratio:.2f} < {self.min_contrast_ratio}")
            return False, float(contrast_ratio), f"Do tuong phan Mat vs Da qua thap ({contrast_ratio:.2f})"

        if blur_var < self.min_blur_var:
            logger.warning(f"Spoof detected: Variance {blur_var:.2f} < {self.min_blur_var} (Too blurry)")
            return False, float(blur_var), f"Anh qua mo / Mat net (variance: {blur_var:.2f})"
        
        if blur_var > self.max_blur_var:
            logger.warning(f"Spoof detected: Variance {blur_var:.2f} > {self.max_blur_var} (Too noisy/screen moire)")
            return False, float(blur_var), f"Nhieu ket cau man hinh/Giay in (variance: {blur_var:.2f})"

        logger.info("Liveness check PASSED: Face is REAL")
        return True, float(contrast_ratio), "REAL"
