#!/usr/bin/env python3
import os
import sys
import ctypes
import numpy as np
import cv2

try:
    import gi
    gi.require_version('Gst', '1.0')
    from gi.repository import Gst, GLib
except ImportError:
    print("Error: PyGObject or GStreamer bindings not found.")
    sys.exit(1)

# Định nghĩa GstMapInfo phục vụ zero-copy
class GstMapInfo(ctypes.Structure):
    _fields_ = [
        ("memory", ctypes.c_void_p),
        ("flags", ctypes.c_int),
        ("data", ctypes.c_void_p),
        ("size", ctypes.c_size_t),
        ("maxsize", ctypes.c_size_t),
        ("user_data", ctypes.c_void_p * 4),
        ("_gst_reserved", ctypes.c_void_p * 4)
    ]

# Tải libgstreamer
try:
    libgst = ctypes.CDLL("libgstreamer-1.0.so.0")
except OSError:
    try:
        libgst = ctypes.CDLL("libgstreamer-1.0.so")
    except OSError:
        libgst = None

if libgst:
    libgst.gst_buffer_map.argtypes = [ctypes.c_void_p, ctypes.POINTER(GstMapInfo), ctypes.c_int]
    libgst.gst_buffer_map.restype = ctypes.c_bool
    libgst.gst_buffer_unmap.argtypes = [ctypes.c_void_p, ctypes.POINTER(GstMapInfo)]
    libgst.gst_buffer_unmap.restype = None

def main():
    # Nhận nguồn camera từ tham số dòng lệnh (mặc định là cổng CSI - libcamerasrc)
    source_device = "libcamerasrc"
    if len(sys.argv) > 1:
        source_device = sys.argv[1]
        if source_device.isdigit():
            source_device = f"/dev/video{source_device}"

    print("==================================================")
    print("      TEST CAMERA HỒNG NGOẠI (IR ONLY TEST)       ")
    print("==================================================")
    print(f"Device nguồn: {source_device}")
    print("Nhấn phím 'q' hoặc 'ESC' trên cửa sổ hiển thị để THOÁT.")
    print("==================================================")

    Gst.init(None)

    # Xây dựng Pipeline GStreamer đọc GRAY8 (Hồng ngoại)
    if "libcamerasrc" in source_device:
        pipeline_str = (
            "libcamerasrc ! video/x-raw, format=NV12, width=640, height=480 ! "
            "videoconvert ! video/x-raw, format=GRAY8 ! "
            "appsink name=ir_sink sync=false max-buffers=1 drop=true emit-signals=true"
        )
        print("Sử dụng nguồn CSI libcamerasrc (Cổng CSI mặc định)")
    else:
        pipeline_str = (
            f"v4l2src device={source_device} ! videoconvert ! videoscale ! "
            f"video/x-raw, width=640, height=480, format=GRAY8 ! "
            f"appsink name=ir_sink sync=false max-buffers=1 drop=true emit-signals=true"
        )
        print(f"Sử dụng nguồn USB V4L2 device: {source_device}")

    print(f"GStreamer Pipeline: {pipeline_str}\n")
    
    try:
        pipeline = Gst.parse_launch(pipeline_str)
    except Exception as e:
        print(f"Lỗi khởi tạo Pipeline: {e}")
        sys.exit(1)

    appsink = pipeline.get_by_name("ir_sink")
    if not appsink:
        print("Không tìm thấy appsink name=ir_sink")
        sys.exit(1)

    frame_holder = {"frame": None, "count": 0, "first_call": True}
    loop = GLib.MainLoop()

    # Thêm bộ lắng nghe Bus để in toàn bộ lỗi/cảnh báo từ GStreamer ra Console
    bus = pipeline.get_bus()
    bus.add_signal_watch()
    
    def on_bus_message(bus, message):
        t = message.type
        if t == Gst.MessageType.ERROR:
            err, debug = message.parse_error()
            print(f"\n[GStreamer ERROR] {err.message}")
            print(f"[GStreamer DEBUG] {debug}")
            loop.quit()
        elif t == Gst.MessageType.WARNING:
            err, debug = message.parse_warning()
            print(f"\n[GStreamer WARNING] {err.message}")
        elif t == Gst.MessageType.EOS:
            print("\n[GStreamer EOS] Luồng dữ liệu kết thúc (End of Stream).")
            loop.quit()
            
    bus.connect("message", on_bus_message)

    # Callback đón mẫu khung hình mới
    def on_new_sample(sink):
        if frame_holder["first_call"]:
            print("-> [CALLBACK] Nhận được khung hình đầu tiên từ camera IR!")
            frame_holder["first_call"] = False
            
        sample = sink.emit("pull-sample")
        if not sample:
            return Gst.FlowReturn.OK
        
        buffer = sample.get_buffer()
        if not buffer:
            return Gst.FlowReturn.OK

        h, w = 480, 640
        caps = sample.get_caps()
        if caps:
            structure = caps.get_structure(0)
            w = structure.get_int("width")[1]
            h = structure.get_int("height")[1]

        # Ánh xạ bộ nhớ ctypes
        mapped_success = False
        if libgst:
            buf_ptr = hash(buffer)
            map_info = GstMapInfo()
            if libgst.gst_buffer_map(buf_ptr, ctypes.byref(map_info), 1):
                try:
                    data_ptr = ctypes.cast(map_info.data, ctypes.POINTER(ctypes.c_ubyte))
                    arr = np.ctypeslib.as_array(data_ptr, shape=(h, w))
                    frame_holder["frame"] = arr.copy()
                    frame_holder["count"] += 1
                    mapped_success = True
                except Exception as e:
                    print(f"Lỗi map buffer ctypes: {e}")
                finally:
                    libgst.gst_buffer_unmap(buf_ptr, ctypes.byref(map_info))
        
        if not mapped_success:
            # Fallback nếu CDLL không tải được hoặc map thất bại
            success, map_info = buffer.map(Gst.MapFlags.READ)
            if success:
                try:
                    arr = np.frombuffer(map_info.data, dtype=np.uint8)
                    frame_holder["frame"] = arr.reshape((h, w)).copy()
                    frame_holder["count"] += 1
                except Exception as e:
                    print(f"Lỗi map buffer fallback: {e}")
                finally:
                    buffer.unmap(map_info)

        return Gst.FlowReturn.OK

    appsink.connect("new-sample", on_new_sample)

    # Timer cập nhật hiển thị OpenCV GUI
    def update_window():
        if frame_holder["frame"] is not None:
            frame = frame_holder["frame"]
            
            # Tính độ tương phản và độ mờ để người dùng căn chỉnh ống kính tại chỗ
            laplacian = cv2.Laplacian(frame, cv2.CV_64F)
            blur_var = laplacian.var()
            
            # Vẽ thông tin chẩn đoán lên ảnh hiển thị
            display_frame = cv2.cvtColor(frame, cv2.COLOR_GRAY2BGR)
            
            # Thông tin text hướng dẫn căn nét thủ công
            cv2.putText(display_frame, f"Frames: {frame_holder['count']}", (15, 30), 
                        cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
            cv2.putText(display_frame, f"Blur Var (Focus Vitals): {blur_var:.1f}", (15, 60), 
                        cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
            cv2.putText(display_frame, "Rotate camera lens to maximize Focus Vitals", (15, 90), 
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 255), 1)
            cv2.putText(display_frame, "Press 'q' to Quit", (15, 120), 
                        cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
            
            cv2.imshow("IR Camera Focus Tool", display_frame)
            key = cv2.waitKey(1) & 0xFF
            if key == ord('q') or key == 27:
                loop.quit()
                return False
        return True

    # Chạy cập nhật GUI sau mỗi 30ms
    GLib.timeout_add(30, update_window)

    print("Đang khởi động luồng phát camera...")
    ret = pipeline.set_state(Gst.State.PLAYING)
    if ret == Gst.StateChangeReturn.FAILURE:
        print("Lỗi: Không thể chuyển trạng thái camera sang PLAYING.")
        sys.exit(1)

    print("Camera IR đang hoạt động. Cửa sổ hiển thị trực quan đã mở.")
    try:
        loop.run()
    except KeyboardInterrupt:
        pass

    print("Đang tắt camera...")
    pipeline.set_state(Gst.State.NULL)
    cv2.destroyAllWindows()
    print("Hoàn tất.")

if __name__ == "__main__":
    main()
