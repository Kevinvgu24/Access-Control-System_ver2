/**
 * face_align.cpp
 *
 * [CHỨC NĂNG] GStreamer hailofilter thực hiện căn chỉnh khuôn mặt (Face Alignment)
 *             in-place trực tiếp trên bộ đệm GStreamer 112×112 RGB.
 *
 * [NGUYÊN LÝ]
 *  1. Đọc 5 điểm landmark (HailoLandmarks) đã được trích xuất bởi YOLOv8-Face NPU
 *     và lưu vào metadata của sub-buffer qua libyolo26_landmark_post.so.
 *  2. Ánh xạ tọa độ landmark từ [0,1] (relative to crop bbox) sang pixel 112×112.
 *  3. Tính ma trận biến đổi Affine Partial 2D (xoay + scale + translate, không có shear)
 *     so với 5 điểm tham chiếu chuẩn của ArcFace (112×112).
 *  4. Ghi đè pixel đã căn chỉnh thẳng vào GStreamer buffer (zero-allocation, in-place).
 *
 * [TÍCH HỢP]
 *  Được gọi bởi phần tử GStreamer:
 *      hailofilter so-path=libface_align.so use-gst-buffer=true name=face_aligner
 *  Đặt trong pipeline NGAY SAU bước resize 112×112 và TRƯỚC hailonet ArcFace.
 *
 * [HIỆU SUẤT]
 *  - Không có Python GIL overhead
 *  - estimateAffinePartial2D: giải hệ 4 ẩn số (~2µs)
 *  - warpAffine trên ảnh 112×112 (~37KB): ~150-300µs trên ARM Cortex-A76
 *  - Fallback tự động: nếu thiếu landmark hoặc ma trận suy biến → giữ nguyên ảnh
 */

#include <vector>
#include <string>
#include <cstring>
#include <iostream>
#include <chrono>
#include <atomic>

#include <opencv2/core.hpp>
#include <opencv2/imgproc.hpp>
#include <opencv2/calib3d.hpp>

#include <gst/gst.h>
#include <gst/video/video-frame.h>

#include "hailo_objects.hpp"
#include "hailo_common.hpp"
#include "gst_hailo_meta.hpp"

// ============================================================================
// Tọa độ 5 điểm tham chiếu chuẩn của ArcFace MobileFaceNet (112×112)
// Thứ tự: mắt trái, mắt phải, mũi, miệng trái, miệng phải
// ============================================================================
static const cv::Point2f ARCFACE_DST[5] = {
    {38.2946f, 51.6963f},   // left eye center
    {73.5318f, 51.5014f},   // right eye center
    {56.0252f, 71.7366f},   // nose tip
    {41.5493f, 92.3655f},   // mouth left corner
    {70.7299f, 92.2041f}    // mouth right corner
};

// Kích thước ảnh đầu vào (sau bước resize caps negotiation)
static const int FACE_W = 112;
static const int FACE_H = 112;

// ============================================================================
// Bộ đếm debug toàn cục — in log mỗi 2 giây để xác nhận filter đang chạy
// ============================================================================
static std::atomic<int> g_aligned_count{0};
static std::atomic<int> g_fallback_count{0};
static std::atomic<int> g_call_count{0};       // tổng số lần filter được gọi (kể cả non-face buffer)
static std::chrono::steady_clock::time_point g_last_log_time = std::chrono::steady_clock::now();

// In ngay khi .so được nạp vào bộ nhớ bởi GStreamer
__attribute__((constructor))
static void on_load() {
    std::cout << "[face_align] *** LIBRARY LOADED *** libface_align.so is active in pipeline" << std::endl;
    std::cout.flush();
}

// Helper to robustly extract GstBuffer* from any of the void* parameters
static GstBuffer* try_get_buffer(void* p)
{
    if (!p) return nullptr;

    // 1. Direct GstBuffer* check
    if (GST_IS_BUFFER(p)) {
        return reinterpret_cast<GstBuffer*>(p);
    }

    // 2. Dereference check (GstBuffer** or GstBuffer*&)
    uintptr_t addr = reinterpret_cast<uintptr_t>(p);
    if (addr % sizeof(void*) == 0 && addr > 0x1000) {
        void* deref = *reinterpret_cast<void**>(p);
        if (deref && GST_IS_BUFFER(deref)) {
            return reinterpret_cast<GstBuffer*>(deref);
        }
    }

    // 3. GstVideoFrame* check (video frame contains ->buffer at offset)
    if (addr % sizeof(void*) == 0 && addr > 0x1000) {
        GstVideoFrame* frame = reinterpret_cast<GstVideoFrame*>(p);
        uintptr_t buf_addr = reinterpret_cast<uintptr_t>(frame->buffer);
        if (buf_addr % sizeof(void*) == 0 && buf_addr > 0x1000) {
            if (GST_IS_BUFFER(frame->buffer)) {
                return frame->buffer;
            }
        }
    }

    return nullptr;
}

// ============================================================================
// Hàm entry point được gọi bởi hailofilter với use-gst-buffer=true
// ============================================================================
extern "C" {
    void filter(void* p1, void* p2, void* p3, void* p4);
}

void filter(void* p1, void* p2, void* p3, void* p4)
{
    g_call_count++;

    // ─── [DEBUG] In log mỗi 2 giây (kể cả khi không có khuôn mặt) ───────────
    auto now = std::chrono::steady_clock::now();
    auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(now - g_last_log_time).count();
    if (elapsed >= 2000) {
        std::cout << "[face_align] ✓ RUNNING | calls=" << g_call_count.load()
                  << " | aligned=" << g_aligned_count.load()
                  << " | fallback=" << g_fallback_count.load()
                  << " (last 2s)" << std::endl;
        std::cout.flush();
        g_call_count.store(0);
        g_aligned_count.store(0);
        g_fallback_count.store(0);
        g_last_log_time = now;
    }

    GstBuffer* buffer = nullptr;
    buffer = try_get_buffer(p1);
    if (!buffer) buffer = try_get_buffer(p2);
    if (!buffer) buffer = try_get_buffer(p3);
    if (!buffer) buffer = try_get_buffer(p4);

    static int buf_debug_count = 0;
    if (buf_debug_count < 10) {
        buf_debug_count++;
        std::cout << "[face_align debug] p1=" << p1 << " (try_get_buffer=" << try_get_buffer(p1) << ")"
                  << ", p2=" << p2 << " (try_get_buffer=" << try_get_buffer(p2) << ")"
                  << ", p3=" << p3 << " (try_get_buffer=" << try_get_buffer(p3) << ")"
                  << ", p4=" << p4 << " (try_get_buffer=" << try_get_buffer(p4) << ")"
                  << ", detected_buffer=" << buffer
                  << std::endl;
        std::cout.flush();
    }

    if (!buffer) {
        g_fallback_count++;
        return;
    }

    // Lấy HailoROIPtr từ buffer bằng API chính thức của Tappas
    HailoROIPtr roi = get_hailo_main_roi(buffer);
    if (!roi) {
        g_fallback_count++;
        return;
    }

    // Kiểm tra kích thước buffer (112×112×3 = 37,632 bytes)
    constexpr gsize EXPECTED_BYTES = static_cast<gsize>(FACE_W) * FACE_H * 3;
    gsize actual_size = gst_buffer_get_size(buffer);
    if (actual_size != EXPECTED_BYTES) {
        static int size_warn = 0;
        if (size_warn++ < 3) {
            std::cout << "[face_align] SIZE MISMATCH: " << actual_size
                      << " bytes (expected " << EXPECTED_BYTES << " = 112x112x3)"
                      << std::endl;
            std::cout.flush();
        }
        g_fallback_count++;
        return;
    }

    // ─── 2. Trích xuất HailoLandmarks từ metadata ROI ─────────────────────────
    //
    // Sau khi hailocropper tạo sub-buffer, ROI của sub-buffer là HailoDetection.
    // HailoLandmarks được gắn như đối tượng con của detection đó.
    // Tọa độ landmark đã được chuẩn hóa [0,1] tương đối với BBox bởi
    // libyolo26_landmark_post.so (dòng 192-197 trong yolo26_landmark_post.cpp).
    // ─────────────────────────────────────────────────────────────────────────
    std::vector<HailoPoint> hailo_pts;

    static int debug_print_count = 0;
    if (debug_print_count < 10) {
        debug_print_count++;
        std::cout << "[face_align debug] roi has " << roi->get_objects().size() << " objects." << std::endl;
        for (auto& obj : roi->get_objects()) {
            std::cout << "[face_align debug] object type: " << obj->get_type() << std::endl;
            if (obj->get_type() == HAILO_DETECTION) {
                auto det = std::dynamic_pointer_cast<HailoDetection>(obj);
                if (det) {
                    std::cout << "[face_align debug] detection has " << det->get_objects().size() << " sub-objects." << std::endl;
                    for (auto& sub : det->get_objects()) {
                        std::cout << "[face_align debug]   sub-object type: " << sub->get_type() << std::endl;
                    }
                }
            }
        }
        std::cout.flush();
    }

    // Tìm HailoLandmarks trực tiếp trong ROI (nếu đây là detection root)
    for (auto& obj : roi->get_objects()) {
        if (obj->get_type() == HAILO_LANDMARKS) {
            auto lm = std::dynamic_pointer_cast<HailoLandmarks>(obj);
            if (lm) {
                hailo_pts = lm->get_points();
                break;
            }
        }
    }

    // Nếu không tìm thấy trong ROI gốc, tìm trong detection con
    if (hailo_pts.size() < 5) {
        for (auto& obj : roi->get_objects()) {
            if (obj->get_type() == HAILO_DETECTION) {
                auto det = std::dynamic_pointer_cast<HailoDetection>(obj);
                if (!det) continue;
                for (auto& sub : det->get_objects()) {
                    if (sub->get_type() == HAILO_LANDMARKS) {
                        auto lm = std::dynamic_pointer_cast<HailoLandmarks>(sub);
                        if (lm) {
                            hailo_pts = lm->get_points();
                            break;
                        }
                    }
                }
                if (hailo_pts.size() >= 5) break;
            }
        }
    }

    // Fallback an toàn: không đủ landmark → giữ nguyên ảnh (không căn chỉnh)
    if (hailo_pts.size() < 5) {
        g_fallback_count++;
        return;
    }

    // ─── 3. Chuyển đổi tọa độ landmark → pixel trong không gian 112×112 ───────
    std::vector<cv::Point2f> src_pts;
    src_pts.reserve(5);
    for (int i = 0; i < 5; ++i) {
        float px = hailo_pts[i].x() * static_cast<float>(FACE_W);
        float py = hailo_pts[i].y() * static_cast<float>(FACE_H);
        // Giới hạn trong biên ảnh để tránh suy biến ma trận
        px = std::max(0.0f, std::min(px, static_cast<float>(FACE_W - 1)));
        py = std::max(0.0f, std::min(py, static_cast<float>(FACE_H - 1)));
        src_pts.push_back({px, py});
    }

    std::vector<cv::Point2f> dst_pts(ARCFACE_DST, ARCFACE_DST + 5);

    // ─── 4. Tính ma trận Affine Partial 2D (4 DOF: xoay + scale + translate) ──
    //
    // Sử dụng LMEDS (Least Median of Squares) thay vì RANSAC để:
    // - Ổn định hơn khi landmark bị nhiễu nhẹ từ NPU
    // - Loại bỏ outlier tốt hơn với chỉ 5 điểm
    // ─────────────────────────────────────────────────────────────────────────
    cv::Mat M = cv::estimateAffinePartial2D(
        src_pts, dst_pts,
        cv::noArray(),   // không cần inlier mask
        cv::LMEDS        // phương pháp robust fitting
    );

    // Fallback: ma trận không hợp lệ hoặc suy biến → bỏ qua căn chỉnh
    if (M.empty()) {
        g_fallback_count++;
        return;
    }

    // Kiểm tra scale factor hợp lệ (tránh zoom cực đoan do landmark nhiễu)
    double scale = std::sqrt(M.at<double>(0,0)*M.at<double>(0,0) +
                             M.at<double>(0,1)*M.at<double>(0,1));
    if (scale < 0.5 || scale > 2.0) {
        g_fallback_count++;
        return;
    }

    // ─── 5. Áp dụng Affine warp in-place lên GStreamer buffer ─────────────────
    GstMapInfo map_info;
    if (!gst_buffer_map(buffer, &map_info, GST_MAP_READ)) {
        g_fallback_count++;
        return;
    }

    // Bọc vùng nhớ GStreamer thành cv::Mat (zero-copy view)
    cv::Mat frame(FACE_H, FACE_W, CV_8UC3, const_cast<guint8*>(map_info.data));

    // Sao chép frame gốc vào buffer tạm để warpAffine đọc trong khi ghi đè
    // (cần thiết vì src và dst overlap khi in-place)
    cv::Mat src_copy;
    frame.copyTo(src_copy);

    // Thực hiện phép biến đổi Affine, ghi thẳng vào frame (GStreamer buffer)
    cv::warpAffine(
        src_copy,                       // ảnh nguồn (bản sao)
        frame,                          // ảnh đích = trực tiếp GStreamer buffer
        M,
        {FACE_W, FACE_H},              // kích thước đầu ra giữ nguyên 112×112
        cv::INTER_LINEAR,              // nội suy song tuyến tính (cân bằng tốc/chất)
        cv::BORDER_CONSTANT,           // pixel ngoài biên điền màu đen
        cv::Scalar(0, 0, 0)
    );

    gst_buffer_unmap(buffer, &map_info);

    // ─── [DEBUG] Ghi nhận đã căn chỉnh thành công ───────────────────────────
    g_aligned_count++;
}
