import time
import threading
import os
import sys
os.environ["HAILORT_LOGGER_PATH"] = "NONE"
import numpy as np
import gc
import cv2
import ctypes
import sqlite3
from logger import get_logger

logger = get_logger("app")

# GStreamer and GLib Imports
import gi
gi.require_version('Gst', '1.0')
from gi.repository import Gst, GLib
import hailo

from utils import cosine_to_percentage
from hardware import HardwareMonitor
from database import FaceDatabase
from anti_spoofing import IRLivenessDetector

# [CĂN CHỈNH] Tọa độ 5 điểm tham chiếu chuẩn của ArcFace MobileFaceNet (112×112)
# Thứ tự: mắt trái, mắt phải, mũi, miệng trái, miệng phải
ARCFACE_REFERENCE_5PTS = np.array([
    [38.2946, 51.6963],
    [73.5318, 51.5014],
    [56.0252, 71.7366],
    [41.5493, 92.3655],
    [70.7299, 92.2041]
], dtype=np.float32)

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

try:
    libgst = ctypes.CDLL("libgstreamer-1.0.so.0")
except OSError:
    libgst = ctypes.CDLL("libgstreamer-1.0.so")

libgst.gst_buffer_map.argtypes = [ctypes.c_void_p, ctypes.POINTER(GstMapInfo), ctypes.c_int]
libgst.gst_buffer_map.restype = ctypes.c_bool
libgst.gst_buffer_unmap.argtypes = [ctypes.c_void_p, ctypes.POINTER(GstMapInfo)]
libgst.gst_buffer_unmap.restype = None

# [FIX] Lấy địa chỉ C pointer thực của GstBuffer từ PyGObject wrapper.
# Dùng 3 phương pháp theo thứ tự an toàn giảm dần.

_GOBJECT_OFFSET_CALIBRATED = True  # sentinel, không còn dùng runtime calibration

def _gst_buf_ptr(buf):
    """
    Trả về địa chỉ C pointer thực của GstBuffer (GObject) từ PyGObject wrapper.
    Thử các phương pháp theo thứ tự an toàn:
      1. buf.__gpointer__ — PyGObject >= 3.46 (aarch64 Raspberry Pi OS Bookworm)
      2. ctypes offset tại id(buf)+16 (CPython 3.x aarch64 standard layout)
      3. None (kích hoạt PyGObject fallback map an toàn)
    """
    # Phương pháp 1: PyGObject expose __gpointer__ (Capsule chứa con trỏ GObject)
    try:
        import ctypes as _ct
        gp = getattr(buf, '__gpointer__', None)
        if gp is not None:
            ptr = _ct.pythonapi.PyCapsule_GetPointer(
                _ct.py_object(gp), _ct.c_char_p(None)
            )
            if ptr and ptr > 0x1000:
                return ptr
    except Exception:
        pass

    # Phương pháp 2: Đọc trực tiếp từ CPython object layout
    # PyGObject struct: [ob_refcnt(8)] [ob_type(8)] [inst_dict hoặc handle(8)] [weakref(8)] [gobj_ptr(8)]
    # Trên CPython 3.x aarch64 chuẩn, GObject ptr thường ở offset 16 hoặc 24.
    base = id(buf)
    try:
        import ctypes as _ct
        for offset in (16, 24, 32):
            candidate = _ct.cast(base + offset, _ct.POINTER(_ct.c_void_p)).contents.value
            # Sanity check: địa chỉ hợp lệ > 4KB. Bỏ giới hạn trên vì AArch64 48-bit pointer có thể rất lớn.
            if candidate and candidate > 0x1000:
                return candidate
    except Exception:
        pass

    # Phương pháp 3: None → kích hoạt PyGObject fallback
    return None

def _calibrate_gobject_offset(buf):
    """Không còn dùng — kept for backward compatibility."""
    pass


class ProfessionalSmartDoor:
    def __init__(self, yolo_hef, arcface_hef, anti_spoofing_hef, lbf_model_path, database_dir, rec_thresh=0.45, close_thresh=130):
        self.yolo_hef = yolo_hef
        self.arcface_hef = arcface_hef
        self.rec_thresh = rec_thresh
        self.close_thresh = close_thresh
        self.stationary_max_dist = 20

        # Load DB
        self.db_path = os.path.join(database_dir, "smart_door.db")
        self.db = FaceDatabase(self.db_path)
        self.known_users = self.db.load_all_users()
        logger.info(f"Loaded {len(self.known_users)} users from SQLite.")

        # Rebuild matrix
        self._known_names = []
        self._known_matrix = None
        self._rebuild_db_matrix()
        self._sync_db_to_binary()

        # Monitor DB users table state for cross-process hot-reloads
        self._last_db_check_time = time.time()
        self._last_db_state = self._get_db_state()

        # Hardware Monitor
        self.hw_monitor = HardwareMonitor(check_interval=2.0).start()

        # Start background database monitoring thread to avoid blocking the NPU pipeline
        self._db_monitor_active = True
        self._db_monitor_thread = threading.Thread(target=self._monitor_db_loop, daemon=True)
        self._db_monitor_thread.start()

        # Pipeline variables
        self.pipeline = None
        self.loop = None
        self.stats_overlay = None
        self._frame_count = 0
        self._fps_start_time = time.time()
        self._fps = 0.0
        self.recognition_callback = None
        self.recognition_enabled = True
        # [OPT] Cache appsink frame dimensions — caps.get_structure() mỗi frame là lãng phí
        self._cached_appsink_size = None

        # IR Camera liveness variables
        self.latest_ir_frame = None
        self.ir_pipeline = None
        self.ir_liveness_detector = IRLivenessDetector()
        self._last_ir_save_time = 0.0

        # Start background thread for high-speed IR livestreaming
        self.stream_thread = threading.Thread(target=self._stream_sender_loop, daemon=True)
        self.stream_thread.start()

    def _get_db_state(self):
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            cursor.execute("SELECT count(*), max(updatedAt) FROM users")
            state = cursor.fetchone()
            conn.close()
            return state if state else (0, "")
        except Exception:
            return (0, "")

    def _monitor_db_loop(self):
        """Periodically check SQLite users table for updates and rebuild the C++ database binary in background."""
        while self._db_monitor_active:
            try:
                time.sleep(3.0)
                current_state = self._get_db_state()
                if current_state != self._last_db_state:
                    logger.info("[DB Monitor] Users table update detected! Reloading in background...")
                    known_users = self.db.load_all_users()
                    
                    if known_users:
                        names = list(known_users.keys())
                        vecs = np.stack(list(known_users.values())).astype(np.float32)
                        norms = np.linalg.norm(vecs, axis=1, keepdims=True)
                        known_matrix = vecs / np.where(norms > 0, norms, 1.0)
                    else:
                        names = []
                        known_matrix = None
                    
                    current_dir = os.path.dirname(os.path.abspath(__file__))
                    workspace_dir = os.path.abspath(os.path.join(current_dir, "..", ".."))
                    bin_path = os.path.join(workspace_dir, "scratch", "db.bin")
                    
                    os.makedirs(os.path.dirname(bin_path), exist_ok=True)
                    with open(bin_path, "wb") as f:
                        n = len(known_users)
                        f.write(np.int32(n).tobytes())
                        for name, emb in known_users.items():
                            name_bytes = name.encode('utf-8')[:63]
                            name_bytes = name_bytes + b'\x00' * (64 - len(name_bytes))
                            f.write(name_bytes)
                            f.write(emb.astype(np.float32).tobytes())
                            
                    # Thread-safe updates (atomic pointers swap)
                    self.known_users = known_users
                    self._known_names = names
                    self._known_matrix = known_matrix
                    self._last_db_state = current_state
                    logger.info(f"[DB Monitor] Successfully reloaded and synced {len(known_users)} users in background.")
            except Exception as e:
                logger.error(f"[DB Monitor] Error in database monitoring thread: {e}")

    def _rebuild_db_matrix(self):
        """Build L2-normalised (N×512) matrix for one-shot vectorised search."""
        if not self.known_users:
            self._known_names = []
            self._known_matrix = None
            return
        names = list(self.known_users.keys())
        vecs = np.stack(list(self.known_users.values())).astype(np.float32)
        norms = np.linalg.norm(vecs, axis=1, keepdims=True)
        self._known_names = names
        self._known_matrix = vecs / np.where(norms > 0, norms, 1.0)

    def _sync_db_to_binary(self):
        """
        [CHỨC NĂNG] Đồng bộ cơ sở dữ liệu người dùng từ SQLite ra một tệp nhị phân phẳng (db.bin).
        [LIÊN KẾT] Tệp db.bin này sẽ được bộ so khớp C++ (libdb_matcher_post.so) đọc vào bộ nhớ 
                  ở tầng GStreamer để so khớp vector embedding với tốc độ cao bằng ngôn ngữ C++.
        """
        current_dir = os.path.dirname(os.path.abspath(__file__))
        workspace_dir = os.path.abspath(os.path.join(current_dir, "..", ".."))
        bin_path = os.path.join(workspace_dir, "scratch", "db.bin")
        try:
            os.makedirs(os.path.dirname(bin_path), exist_ok=True)
            with open(bin_path, "wb") as f:
                n = len(self.known_users)
                # Ghi số lượng người dùng (int32)
                f.write(np.int32(n).tobytes())
                for name, emb in self.known_users.items():
                    # Ghi tên người dùng cố định 64 bytes (null-padded)
                    name_bytes = name.encode('utf-8')[:63]
                    name_bytes = name_bytes + b'\x00' * (64 - len(name_bytes))
                    f.write(name_bytes)
                    # Ghi vector embedding 512 chiều (float32)
                    f.write(emb.astype(np.float32).tobytes())
            logger.info(f"Synced {n} users to {bin_path} for C++ DB Matcher.")
        except Exception as e:
            logger.error(f"Failed to sync DB to binary: {e}")

    def _search_db(self, embedding: np.ndarray) -> tuple[str, float]:
        """
        [CHỨC NĂNG] Hàm dự phòng so khớp cơ sở dữ liệu bằng Python (sử dụng nhân ma trận BLAS).
        [LIÊN KẾT] Chỉ dùng khi cần gọi so khớp trực tiếp trong Python (không tham gia vào live pipeline).
        """
        if self._known_matrix is None:
            return "Unknown", 0.0
        # Chuẩn hóa vector đầu vào
        norm = np.linalg.norm(embedding)
        if norm > 0:
            embedding = embedding / norm
        sims = self._known_matrix @ embedding.astype(np.float32)  # shape (N,)
        idx = int(np.argmax(sims))
        best_sim = float(sims[idx])
        if best_sim >= self.rec_thresh:
            return self._known_names[idx], best_sim
        else:
            return "Unknown", best_sim

    def on_new_frame_probe(self, pad, info, user_data):
        global _GOBJECT_OFFSET_CALIBRATED
        buffer = info.get_buffer()
        if buffer is None:
            return Gst.PadProbeReturn.OK

        # [CALIBRATION] Tự hiệu chỉnh GObject offset khi frame đầu tiên tới
        if not _GOBJECT_OFFSET_CALIBRATED:
            _calibrate_gobject_offset(buffer)
            _GOBJECT_OFFSET_CALIBRATED = True

        # Calculate FPS
        self._frame_count += 1
        now = time.time()
        elapsed = now - self._fps_start_time
        if elapsed >= 1.0:
            self._fps = self._frame_count / elapsed
            self._frame_count = 0
            self._fps_start_time = now

            cpu_t = self.hw_monitor.cpu_temp
            hailo_t = self.hw_monitor.hailo_temp
            ram_mb = self.hw_monitor.ram_mb

            # Update stats overlay text (every 1 second)
            if self.stats_overlay:
                stats_text = f"FPS: {self._fps:.1f} | CPU: {cpu_t:.1f}C | Hailo: {hailo_t:.1f}C | RAM: {ram_mb:.1f}MB"
                self.stats_overlay.set_property("text", stats_text)

            # Update telemetry in local SQLite database via a background thread to prevent GStreamer thread lag
            node_id = os.environ.get("NODE_ID", "default-node")
            lab_id = os.environ.get("LAB_ID", "default-lab")
            def async_telemetry():
                try:
                    self.db.update_node_telemetry(
                        nodeId=node_id,
                        status="online",
                        onlineState="online",
                        cameraFps=self._fps,
                        cpuPercent=45.0,  # mock CPU load
                        ramPercent=ram_mb / 40.0, # scale to percentage based on Pi RAM
                        temperatureC=cpu_t,
                        labId=lab_id,
                        modelStatus="running"
                    )
                except Exception as e:
                    logger.error(f"[DB TELEMETRY ERROR] {e}")
            threading.Thread(target=async_telemetry, daemon=True).start()
            
            # Force immediate garbage collection of PyGObject wrappers
            gc.collect()

        # [CHỨC NĂNG] Nhận danh sách các đối tượng khuôn mặt (Detections) từ metadata của buffer
        # [LIÊN KẾT] Các đối tượng này được sinh ra từ yolo26_landmark_post.cpp và cập nhật bởi db_matcher_post.cpp
        roi = hailo.get_roi_from_buffer(buffer)
        detections = roi.get_objects_typed(hailo.HAILO_DETECTION)
        
        # Lấy kích thước hiện tại của khung hình video
        caps = pad.get_current_caps()
        if caps:
            structure = caps.get_structure(0)
            w = structure.get_int("width")[1]
            h = structure.get_int("height")[1]
        else:
            w, h = 640, 640

        # [CHỨC NĂNG] Lấy thông tin nhận diện khuôn mặt và landmarks để gửi về giao diện (UI)
        detections_info = []
        if getattr(self, "recognition_enabled", True):
            for det in detections:
                bbox = det.get_bbox()
                xmin = bbox.xmin()
                ymin = bbox.ymin()
                w_box = bbox.width()
                h_box = bbox.height()
                
                # Chuyển đổi tọa độ bbox từ tỉ lệ (%) sang pixel thực tế của khung hình
                x1 = int(xmin * w)
                y1 = int(ymin * h)
                x2 = int((xmin + w_box) * w)
                y2 = int((ymin + h_box) * h)
                
                # Giới hạn tọa độ trong biên khung hình tránh crash OpenCV
                x1 = max(0, min(x1, w - 1))
                y1 = max(0, min(y1, h - 1))
                x2 = max(0, min(x2, w - 1))
                y2 = max(0, min(y2, h - 1))
                
                # Lấy class_id từ C++ DB Matcher: 0 = Đã nhận diện (Xanh lá), 1 = Unknown (Đỏ)
                class_id = det.get_class_id()
                label = det.get_label()
                
                # [LIÊN KẾT] Đọc kết quả phân lớp "recognition" được đính kèm bởi db_matcher_post.cpp
                display_text = label
                for sub in det.get_objects():
                    if isinstance(sub, hailo.HailoClassification):
                        if sub.get_classification_type() == "recognition":
                            display_text = sub.get_label()
                            break
                
                # [LIÊN KẾT] Đọc các điểm landmarks (5 điểm mốc) được sinh ra từ mô hình YOLOv8-Face
                landmarks_pts = []
                for sub in det.get_objects():
                    if isinstance(sub, hailo.HailoLandmarks):
                        for pt in sub.get_points():
                            px = int(x1 + pt.x() * (x2 - x1))
                            py = int(y1 + pt.y() * (y2 - y1))
                            px = max(0, min(px, w - 1))
                            py = max(0, min(py, h - 1))
                            landmarks_pts.append((pt.x(), pt.y(), px, py))
                
                detections_info.append({
                    "class_id": class_id,
                    "label": display_text,
                    "bbox": (xmin, ymin, w_box, h_box),
                    "coords": (x1, y1, x2, y2),
                    "landmarks": landmarks_pts
                })
                
            if len(detections_info) > 0 and self.recognition_callback is not None:
                self.recognition_callback(detections_info)

            # [CHỨC NĂNG] Ánh xạ bộ nhớ đệm GStreamer thô bằng ctypes (Zero-Copy) để cho phép vẽ đè trong Python
            # [LIÊN KẾT] Khắc phục lỗi PyGObject cấm ghi đè vùng nhớ (ReadOnly), giúp OpenCV vẽ HUD trực tiếp cực nhanh
            buf_ptr = _gst_buf_ptr(buffer)
            if buf_ptr:
                map_info = GstMapInfo()
                success = libgst.gst_buffer_map(buf_ptr, ctypes.byref(map_info), 1)
                if success:
                    try:
                        # Ép kiểu dữ liệu sang con trỏ byte C và bọc thành mảng NumPy (Không nhân bản vùng nhớ)
                        data_ptr = ctypes.cast(map_info.data, ctypes.POINTER(ctypes.c_ubyte))
                        arr = np.ctypeslib.as_array(data_ptr, shape=(h, w, 3))
                        self.latest_rgb_frame = arr.copy()
                        
                        for info_item in detections_info:
                            x1, y1, x2, y2 = info_item["coords"]
                            class_id = info_item["class_id"]
                            display_text = info_item["label"]
                            
                            color = (0, 255, 0) if class_id == 0 else (0, 0, 255)
                            
                            # Vẽ góc Sci-Fi nổi bật (2 đoạn thẳng ngắn ở mỗi góc vuông của Bounding Box)
                            length = int(min(x2 - x1, y2 - y1) * 0.18)
                            length = max(10, min(length, 30))
                            thickness = 3
                            
                            # Góc trên bên trái
                            cv2.line(arr, (x1, y1), (x1 + length, y1), color, thickness)
                            cv2.line(arr, (x1, y1), (x1, y1 + length), color, thickness)
                            # Góc trên bên phải
                            cv2.line(arr, (x2, y1), (x2 - length, y1), color, thickness)
                            cv2.line(arr, (x2, y1), (x2, y1 + length), color, thickness)
                            # Góc dưới bên trái
                            cv2.line(arr, (x1, y2), (x1 + length, y2), color, thickness)
                            cv2.line(arr, (x1, y2), (x1, y2 - length), color, thickness)
                            # Góc dưới bên phải
                            cv2.line(arr, (x2, y2), (x2 - length, y2), color, thickness)
                            cv2.line(arr, (x2, y2), (x2, y2 - length), color, thickness)
                            
                            # Vẽ nhãn tên kèm phần trăm tương đồng lên phía trên bounding box (có đổ bóng viền đen dễ nhìn)
                            font = cv2.FONT_HERSHEY_SIMPLEX
                            font_scale = 0.55
                            text_thickness = 2
                            cv2.putText(arr, display_text, (x1, y1 - 8), font, font_scale, (0, 0, 0), text_thickness + 2, cv2.LINE_AA)
                            cv2.putText(arr, display_text, (x1, y1 - 8), font, font_scale, color, text_thickness, cv2.LINE_AA)
                            
                            # Vẽ các điểm landmarks
                            for lm in info_item["landmarks"]:
                                _, _, px, py = lm
                                cv2.circle(arr, (px, py), 3, (255, 0, 255), -1)
                    finally:
                        libgst.gst_buffer_unmap(buf_ptr, ctypes.byref(map_info))

        return Gst.PadProbeReturn.OK

    def on_face_crop_probe(self, pad, info, user_data):
        """
        [CĂN CHỈNH KHUÔN MẶT] Python pad probe trên queue_align.src
        Thực hiện Affine alignment bằng 5 điểm landmark YOLO trước khi ArcFace NPU
        trích xuất embedding. Dùng ctypes để ghi trực tiếp vào buffer 112×112.
        Fallback an toàn: nếu thiếu landmark hoặc ma trận không hợp lệ → giữ nguyên ảnh.
        """
        buffer = info.get_buffer()
        if buffer is None:
            return Gst.PadProbeReturn.OK

        # Lấy HailoROI từ sub-buffer của hailocropper
        try:
            roi = hailo.get_roi_from_buffer(buffer)
        except Exception:
            return Gst.PadProbeReturn.OK

        # Tìm HailoLandmarks trong metadata
        landmarks_pts = None
        for obj in roi.get_objects():
            if isinstance(obj, hailo.HailoLandmarks):
                pts = obj.get_points()
                if len(pts) >= 5:
                    landmarks_pts = [[pt.x(), pt.y()] for pt in pts[:5]]
                break

        if not landmarks_pts:
            return Gst.PadProbeReturn.OK

        # Map buffer với ctypes để ghi trực tiếp (giống on_new_frame_probe)
        buf_ptr = _gst_buf_ptr(buffer)
        if not buf_ptr:
            return Gst.PadProbeReturn.OK
        map_info = GstMapInfo()
        success = libgst.gst_buffer_map(buf_ptr, ctypes.byref(map_info), 1)
        if not success:
            return Gst.PadProbeReturn.OK

        try:
            data_ptr = ctypes.cast(map_info.data, ctypes.POINTER(ctypes.c_ubyte))
            arr = np.ctypeslib.as_array(data_ptr, shape=(112, 112, 3))

            # Scale landmark [0,1] → pixel trong không gian 112×112
            src_pts = np.array(
                [[pt[0] * 112.0, pt[1] * 112.0] for pt in landmarks_pts],
                dtype=np.float32
            )

            M, _ = cv2.estimateAffinePartial2D(
                src_pts, ARCFACE_REFERENCE_5PTS, method=cv2.LMEDS
            )

            if M is not None:
                scale = np.sqrt(M[0, 0]**2 + M[0, 1]**2)
                if 0.5 <= scale <= 2.0:
                    aligned = cv2.warpAffine(
                        arr.copy(), M, (112, 112),
                        flags=cv2.INTER_LINEAR,
                        borderMode=cv2.BORDER_CONSTANT,
                        borderValue=(0, 0, 0)
                    )
                    np.copyto(arr, aligned)
        except Exception:
            pass  # Fallback: giữ nguyên ảnh thô
        finally:
            libgst.gst_buffer_unmap(buf_ptr, ctypes.byref(map_info))

        return Gst.PadProbeReturn.OK

    def on_new_appsink_sample(self, appsink, callback):
        sample = appsink.emit("pull-sample")
        if sample is None:
            return Gst.FlowReturn.OK

        buffer = sample.get_buffer()
        if buffer is None:
            return Gst.FlowReturn.OK

        # [OPT] Cache (w, h) sau lần đọc đầu tiên — caps không thay đổi khi pipeline PLAYING
        if self._cached_appsink_size is None:
            caps = sample.get_caps()
            if caps:
                structure = caps.get_structure(0)
                self._cached_appsink_size = (
                    structure.get_int("width")[1],
                    structure.get_int("height")[1]
                )
            else:
                self._cached_appsink_size = (640, 640)
        w, h = self._cached_appsink_size

        # --- Path 1: ctypes zero-copy (nhanh nhất) ---
        buf_ptr = _gst_buf_ptr(buffer)
        frame_delivered = False
        if buf_ptr:
            map_info = GstMapInfo()
            success = libgst.gst_buffer_map(buf_ptr, ctypes.byref(map_info), 1)
            if success:
                try:
                    data_ptr = ctypes.cast(map_info.data, ctypes.POINTER(ctypes.c_ubyte))
                    arr = np.ctypeslib.as_array(data_ptr, shape=(h, w, 3))
                    self.latest_ir_frame = arr
                    callback(arr.copy())
                    frame_delivered = True
                except Exception as e:
                    logger.error(f"[Appsink] ctypes frame mapping failed: {e}")
                finally:
                    libgst.gst_buffer_unmap(buf_ptr, ctypes.byref(map_info))

        # --- Path 2: PyGObject fallback (an toàn, không phụ thuộc layout CPython) ---
        if not frame_delivered:
            try:
                success, map_info_pg = buffer.map(Gst.MapFlags.READ)
                if success:
                    try:
                        arr = np.frombuffer(map_info_pg.data, dtype=np.uint8)
                        if arr.size == h * w * 3:
                            arr = arr.reshape((h, w, 3)).copy()
                            self.latest_ir_frame = arr
                            callback(arr)
                            frame_delivered = True
                        else:
                            logger.warning(f"[Appsink] Fallback buffer size mismatch: {arr.size} != {h*w*3}")
                    finally:
                        buffer.unmap(map_info_pg)
            except Exception as e:
                logger.error(f"[Appsink] PyGObject fallback frame mapping failed: {e}")

        if not frame_delivered:
            logger.warning("[Appsink] Frame dropped: both ctypes and PyGObject mapping paths failed.")

        return Gst.FlowReturn.OK

    def start_ir_camera(self, ir_source="libcamerasrc"):
        """Khởi động luồng đọc IR camera sử dụng GStreamer"""
        if str(ir_source).isdigit() or str(ir_source).startswith("/dev/video"):
            dev = f"/dev/video{ir_source}" if str(ir_source).isdigit() else ir_source
            csi_pipeline_str = (
                f"v4l2src device={dev} ! videoconvert ! videoscale ! "
                f"video/x-raw, width=640, height=480, format=GRAY8 ! "
                f"appsink name=ir_sink sync=false max-buffers=1 drop=true emit-signals=true"
            )
        else:
            # Default to libcamerasrc for CSI slot (matching the verified working scratch script)
            csi_pipeline_str = (
                "libcamerasrc ! video/x-raw, format=NV12, width=640, height=480 ! "
                "videoconvert ! video/x-raw, format=GRAY8 ! "
                "appsink name=ir_sink sync=false max-buffers=1 drop=true emit-signals=true"
            )
        logger.info(f"Initializing IR Camera pipeline with: {csi_pipeline_str}")
        try:
            self.ir_pipeline = Gst.parse_launch(csi_pipeline_str)
            ir_sink = self.ir_pipeline.get_by_name("ir_sink")
            if ir_sink:
                ir_sink.connect("new-sample", self._on_ir_sample)
                logger.info("Connected appsink callback for IR Camera.")
            
            ret = self.ir_pipeline.set_state(Gst.State.PLAYING)
            if ret == Gst.StateChangeReturn.FAILURE:
                logger.error("Failed to transition IR Camera pipeline to PLAYING state.")
                bus = self.ir_pipeline.get_bus()
                msg = bus.pop_filtered(Gst.MessageType.ERROR, 0)
                if msg:
                    err, debug = msg.parse_error()
                    logger.error(f"IR Camera GStreamer Error: {err.message}")
                    logger.error(f"IR Camera GStreamer Debug: {debug}")
                self.stop_ir_camera()
            else:
                logger.info("IR Camera GStreamer pipeline is now PLAYING.")
        except Exception as e:
            logger.error(f"Failed to start IR Camera pipeline: {e}")
            self.ir_pipeline = None

    def _on_ir_sample(self, appsink):
        sample = appsink.emit("pull-sample")
        if sample:
            buffer = sample.get_buffer()
            if buffer:
                caps = sample.get_caps()
                if caps:
                    structure = caps.get_structure(0)
                    w = structure.get_int("width")[1]
                    h = structure.get_int("height")[1]
                else:
                    w, h = 640, 480

                # Sử dụng ctypes gst_buffer_map giống như luồng chính để tránh lỗi phân mảnh/binding PyGObject
                if libgst:
                    buf_ptr = _gst_buf_ptr(buffer)
                    map_info = GstMapInfo()
                    if buf_ptr and libgst.gst_buffer_map(buf_ptr, ctypes.byref(map_info), 1):
                        try:
                            data_ptr = ctypes.cast(map_info.data, ctypes.POINTER(ctypes.c_ubyte))
                            # GRAY8 chỉ có 1 kênh màu
                            arr = np.ctypeslib.as_array(data_ptr, shape=(h, w))
                            self.latest_ir_frame = arr.copy()
                        except Exception as e:
                            logger.error(f"Error mapping IR buffer via ctypes: {e}")
                        finally:
                            libgst.gst_buffer_unmap(buf_ptr, ctypes.byref(map_info))
                else:
                    success, map_info = buffer.map(Gst.MapFlags.READ)
                    if success:
                        try:
                            arr = np.frombuffer(map_info.data, dtype=np.uint8)
                            self.latest_ir_frame = arr.reshape((h, w)).copy()
                        except Exception as e:
                            logger.error(f"Error mapping IR buffer fallback: {e}")
                        finally:
                            buffer.unmap(map_info)
        return Gst.FlowReturn.OK

    def stop_ir_camera(self):
        if self.ir_pipeline:
            logger.info("Stopping IR Camera pipeline...")
            try:
                self.ir_pipeline.set_state(Gst.State.NULL)
            except Exception:
                pass
            self.ir_pipeline = None
            self.latest_ir_frame = None

    def _stream_sender_loop(self):
        import urllib.request
        import time
        import os
        
        server_url = os.environ.get("SERVER_URL", "http://localhost:5000").rstrip('/')
        lab_id = os.environ.get("LAB_ID", "default-lab")
        node_id = os.environ.get("NODE_ID", "default-node")
        
        url = f"{server_url}/api/labs/{lab_id}/nodes/{node_id}/ir-frame"
        current_dir = os.path.dirname(os.path.abspath(__file__))
        flag_path = os.path.abspath(os.path.join(current_dir, "..", "..", "logs", "ir_stream_active.txt"))
        
        logger.info(f"IR stream sender thread active. Uploading to: {url}")
        
        while True:
            try:
                active = False
                if os.path.exists(flag_path):
                    with open(flag_path, "r") as f:
                        active = f.read().strip() == "1"
                
                if active and self.latest_ir_frame is not None:
                    # Compress in-memory grayscale frame to JPEG (60% quality is perfect balance of bandwidth & detail)
                    success, jpeg = cv2.imencode('.jpg', self.latest_ir_frame, [int(cv2.IMWRITE_JPEG_QUALITY), 60])
                    if success:
                        jpeg_bytes = jpeg.tobytes()
                        req = urllib.request.Request(url, method="POST", data=jpeg_bytes)
                        req.add_header('Content-Type', 'image/jpeg')
                        req.add_header('User-Agent', 'Mozilla/5.0')
                        
                        with urllib.request.urlopen(req, timeout=1.0) as response:
                            response.read()
                
                # Sleep ~0.06s for ~16 FPS
                time.sleep(0.06)
            except Exception as e:
                # Sleep slightly longer on error to prevent CPU spinning
                time.sleep(0.5)

    def verify_liveness_on_ir(self, bbox_coords=None, landmarks=None):
        """
        Kiểm tra tính sống động (Anti-Spoofing / Liveness Check) tập trung chuyên biệt
        cho luồng Camera NoIR (gắn qua cổng cáp CSI của Raspberry Pi 5).
        """
        if getattr(self, "latest_ir_frame", None) is None:
            # Không áp dụng Anti-Spoofing cho Camera RGB thông thường
            return True, 1.0, "No IR Camera frame (Skipped for RGB)"

        ir_frame = self.latest_ir_frame.copy()
        if len(ir_frame.shape) == 3:
            ir_frame = cv2.cvtColor(ir_frame, cv2.COLOR_BGR2GRAY)
            
        h_ir, w_ir = ir_frame.shape[:2]
        ir_face_crop = None
        used_method = "Bounding Box Crop"

        # 1. Thử crop vùng mặt trên ảnh NoIR theo tọa độ bbox từ detector
        if bbox_coords is not None and len(bbox_coords) == 4:
            try:
                bx, by, bw, bh = bbox_coords
                if bw > bx and bh > by and bw <= w_ir and bh <= h_ir:
                    x1, y1, x2, y2 = int(bx), int(by), int(bw), int(bh)
                else:
                    x1, y1 = int(bx), int(by)
                    x2, y2 = int(bx + bw), int(by + bh)

                crop_w = x2 - x1
                crop_h = y2 - y1
                pad_x = int(crop_w * 0.1)
                pad_y = int(crop_h * 0.1)
                x1 = max(0, x1 - pad_x)
                y1 = max(0, y1 - pad_y)
                x2 = min(w_ir, x2 + pad_x)
                y2 = min(h_ir, y2 + pad_y)

                if x2 > x1 and y2 > y1:
                    ir_face_crop = ir_frame[y1:y2, x1:x2]
            except Exception as e:
                logger.error(f"IR Liveness bbox crop error: {e}")

        # 2. Phát hiện bằng Haar Cascade trên ảnh NoIR nếu bbox chưa cắt được
        if ir_face_crop is None or ir_face_crop.size == 0:
            used_method = "Haar Cascade"
            try:
                cascade_path = cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'
                face_cascade = cv2.CascadeClassifier(cascade_path)
                faces = face_cascade.detectMultiScale(ir_frame, scaleFactor=1.1, minNeighbors=3, minSize=(80, 80))
                if len(faces) > 0:
                    faces = sorted(faces, key=lambda x: x[2] * x[3], reverse=True)
                    fx, fy, fw, fh = faces[0]
                    pad_x = int(fw * 0.1)
                    pad_y = int(fh * 0.1)
                    x1 = max(0, fx - pad_x)
                    y1 = max(0, fy - pad_y)
                    x2 = min(w_ir, fx + fw + pad_x)
                    y2 = min(h_ir, fy + fh + pad_y)
                    ir_face_crop = ir_frame[y1:y2, x1:x2]
            except Exception as e:
                logger.error(f"IR Liveness Haar Cascade error: {e}")

        # 3. Fallback: Center Crop ảnh NoIR
        if ir_face_crop is None or ir_face_crop.size == 0:
            used_method = "Center Crop Fallback"
            crop_sz = min(w_ir, h_ir, 320)
            cx, cy = w_ir // 2, h_ir // 2
            x1 = cx - crop_sz // 2
            y1 = cy - crop_sz // 2
            ir_face_crop = ir_frame[y1:y1+crop_sz, x1:x1+crop_sz]

        # Lưu ảnh NoIR chẩn đoán
        try:
            os.makedirs("/home/kevinvgu/Access-Control-System_ver2/logs", exist_ok=True)
            cv2.imwrite("/home/kevinvgu/Access-Control-System_ver2/logs/latest_ir_frame.png", ir_frame)
            if ir_face_crop is not None and ir_face_crop.size > 0:
                cv2.imwrite("/home/kevinvgu/Access-Control-System_ver2/logs/latest_ir_crop.png", ir_face_crop)
                logger.info(f"Saved diagnostic IR crop ({ir_face_crop.shape}) using {used_method}")
        except Exception as e:
            logger.error(f"Failed to save diagnostic IR images: {e}")

        return self.ir_liveness_detector.check_liveness(ir_face_crop, landmarks)

    def run(self, width=640, height=480, source="0", headless=False, appsink_callback=None):
        Gst.init(None)

        # Sentinel: True khi source_str đã được build bởi một trong các branch trước
        _source_handled = False
        source_str = ""
        selected_name = "Unknown"
        is_live = True

        # -------------------------------------------------------
        # Branch 1: libcamerasrc (CSI hoặc UVC qua libcamera)
        # -------------------------------------------------------
        if str(source) == "libcamerasrc" or str(source).startswith("libcamerasrc"):
            cam_idx = 0
            if ":" in str(source):
                try:
                    cam_idx = int(str(source).split(":")[1])
                except Exception:
                    cam_idx = 0

            # [FIX] Kiểm tra xem camera index này có phải USB UVC không.
            # libcamerasrc không hỗ trợ UVC camera — phải dùng v4l2src để tránh not-negotiated (-4).
            import subprocess as _sp, glob as _glob
            _is_uvc = False
            _uvc_dev = None
            try:
                _lc_result = _sp.run(
                    ["libcamera-hello", "--list-cameras"],
                    capture_output=True, text=True, timeout=5
                )
                _cam_list = _lc_result.stdout + _lc_result.stderr
                if cam_idx > 0 and "uvcvideo" in _cam_list.lower():
                    _is_uvc = True
                    logger.info(f"[Camera] libcamerasrc:{cam_idx} is UVC — switching to v4l2src auto-detect.")
                elif cam_idx > 0:
                    # Probe v4l2 devices to find UVC node
                    for _node in sorted(_glob.glob("/dev/video*")):
                        try:
                            _caps_out = _sp.run(
                                ["v4l2-ctl", "--device", _node, "--list-formats-ext"],
                                capture_output=True, text=True, timeout=2
                            ).stdout
                            if "UVC" in _caps_out or "YUY2" in _caps_out or "MJPG" in _caps_out:
                                _is_uvc = True
                                _uvc_dev = _node
                                logger.info(f"[Camera] UVC device found at {_node} — switching from libcamerasrc:{cam_idx}.")
                                break
                        except Exception:
                            continue
            except Exception as _ce:
                logger.warning(f"[Camera] Could not probe camera type: {_ce}")

            if _is_uvc:
                # Redirect sang v4l2src — source biến thành path hoặc "0" để rơi vào Branch 2
                source = _uvc_dev if _uvc_dev else "0"
                # _source_handled = False → sẽ được xử lý ở Branch 2 bên dưới
            else:
                # Camera thực sự là CSI — dùng libcamerasrc
                if cam_idx > 0:
                    os.environ["LIBCAMERA_DEFAULT_CAMERA"] = str(cam_idx)
                    logger.info(f"[Libcamera] Selecting CSI camera index {cam_idx} via LIBCAMERA_DEFAULT_CAMERA")
                else:
                    os.environ.pop("LIBCAMERA_DEFAULT_CAMERA", None)
                source_str = (
                    f"libcamerasrc ! "
                    f"video/x-raw, width={width}, height={height} ! "
                    f"videoconvert n-threads=2 ! "
                    f"videoscale n-threads=2 ! "
                    f"video/x-raw, width=640, height=640, format=RGB"
                )
                selected_name = f"RPi5 Libcamera CSI (index={cam_idx})"
                is_live = True
                _source_handled = True

        # -------------------------------------------------------
        # Branch 2: v4l2src — số nguyên, /dev/videoX, hoặc UVC redirect từ Branch 1
        # -------------------------------------------------------
        if not _source_handled and (str(source).isdigit() or str(source).startswith("/dev/video")):
            dev = f"/dev/video{source}" if str(source).isdigit() else source
            # Auto-detect actual USB camera device node (skip PiSP ISP nodes)
            import glob, subprocess
            if str(source).isdigit():
                video_nodes = sorted(glob.glob("/dev/video*"))
                for node in video_nodes:
                    try:
                        caps_out = subprocess.run(
                            ["v4l2-ctl", "--device", node, "--list-formats-ext"],
                            capture_output=True, text=True, timeout=2
                        ).stdout
                        if "UVC" in caps_out or "YUY2" in caps_out or "MJPG" in caps_out:
                            dev = node
                            logger.info(f"[USB Camera] Auto-detected USB RGB camera at: {dev}")
                            break
                    except Exception:
                        continue

            # Probe which format this camera supports by checking v4l2-ctl output
            supported_formats = ""
            try:
                supported_formats = subprocess.run(
                    ["v4l2-ctl", "--device", dev, "--list-formats-ext"],
                    capture_output=True, text=True, timeout=2
                ).stdout
            except Exception:
                pass

            if "YUYV" in supported_formats or "YUY2" in supported_formats:
                # YUYV raw format - no decoder needed, most reliable for USB cameras
                source_str = (
                    f"v4l2src device={dev} ! "
                    f"video/x-raw, format=YUY2, width=640, height=480, framerate=30/1 ! "
                    f"videoconvert n-threads=2 ! "
                    f"videoscale n-threads=2 ! "
                    f"video/x-raw, width=640, height=640, format=RGB"
                )
                selected_name = "USB RGB Camera YUYV (v4l2src)"
            elif "MJPG" in supported_formats or "MJPEG" in supported_formats:
                # MJPEG fallback - requires jpegdec plugin
                source_str = (
                    f"v4l2src device={dev} ! "
                    f"image/jpeg, width=640, height=480, framerate=30/1 ! "
                    f"jpegdec ! "
                    f"videoconvert n-threads=2 ! "
                    f"videoscale n-threads=2 ! "
                    f"video/x-raw, width=640, height=640, format=RGB"
                )
                selected_name = "USB RGB Camera MJPG (v4l2src)"
            else:
                # Generic fallback — let GStreamer negotiate format automatically
                source_str = (
                    f"v4l2src device={dev} ! "
                    f"videoconvert n-threads=2 ! "
                    f"videoscale n-threads=2 ! "
                    f"video/x-raw, width=640, height=640, format=RGB"
                )
                selected_name = "USB RGB Camera Generic (v4l2src)"

            logger.info(f"[USB Camera] Selected pipeline: {selected_name}")
            is_live = True
            _source_handled = True

        if not _source_handled:
            # Fallback: file source
            source_str = (
                f"filesrc location=\"{source}\" ! decodebin ! "
                f"videoconvert n-threads=2 ! "
                f"videoscale n-threads=2 ! "
                f"video/x-raw, width=640, height=640, format=RGB"
            )
            selected_name = "File Software (Software Scaling/Conversion)"
            is_live = False

        # Sink configuration
        use_headless = headless or "DISPLAY" not in os.environ
        sync_val = "false" if is_live else "true"
        if appsink_callback is not None:
            display_str = f"videoconvert n-threads=2 ! video/x-raw, format=RGB ! appsink name=appsink sync={sync_val} emit-signals=true max-buffers=1 drop=true"
        elif use_headless:
            display_str = f"fakesink sync={sync_val} name=sink"
        else:
            display_str = f"videoconvert n-threads=2 ! autovideosink sync={sync_val} name=sink"

        # Khai báo đường dẫn đến các thư viện xử lý C++ Tappas đã được biên dịch (.so)
        project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        yolo_post_so = os.path.join(project_root, "src/Native_Tappas_CPP/build/libyolo26_landmark_post.so")
        arcface_post_so = os.path.join(project_root, "src/Native_Tappas_CPP/build/libarcface_post.so")
        db_matcher_post_so = os.path.join(project_root, "src/Native_Tappas_CPP/build/libdb_matcher_post.so")
        # [MỚI] Filter căn chỉnh khuôn mặt bằng 5 điểm landmark của YOLO (Affine Partial 2D)
        face_align_so = os.path.join(project_root, "src/Native_Tappas_CPP/build/libface_align.so")
        cropper_so = "/usr/lib/aarch64-linux-gnu/hailo/tappas/post_processes/cropping_algorithms/libdetection_croppers.so"

        # Định nghĩa Pipeline GStreamer kết nối phần cứng và phần mềm
        pipeline_str = (
            f"{source_str} ! " # Lấy nguồn camera và decode/scale sang 640x640 RGB
            f"queue name=queue_scale max-size-buffers=3 leaky=downstream max-size-bytes=0 max-size-time=0 ! "
            
            # [NPU] Nhận dạng khuôn mặt và landmarks bằng YOLOv8-Face trên Hailo NPU
            f"hailonet hef-path={self.yolo_hef} vdevice-group-id=smart_door ! "
            f"queue name=queue_yolo max-size-buffers=3 max-size-bytes=0 max-size-time=0 ! "
            
            # [C++] Giải mã tensor đầu ra của YOLOv8-Face sang tọa độ hộp và 5 điểm mốc
            f"hailofilter so-path={yolo_post_so} ! "
            f"queue name=queue_filter1 max-size-buffers=3 max-size-bytes=0 max-size-time=0 ! "
            
            # [C++] Theo vết khuôn mặt qua các khung hình liên tiếp để theo dõi ID
            f"hailotracker ! "
            f"queue name=queue_tracker max-size-buffers=3 max-size-bytes=0 max-size-time=0 ! "
            
            # [C++] Chia luồng: Cắt ảnh khuôn mặt (crop_detections) để gửi sang nhánh nhận diện ArcFace
            f"hailocropper so-path={cropper_so} function-name=all_detections internal-offset=true name=cropper "
            
            # [C++] Gộp luồng: Nhận ảnh gốc (bypass) từ src_0 và vector embedding từ src_1 để đồng bộ lại
            f"hailoaggregator name=agg ! "
            f"queue name=queue_agg_out max-size-buffers=3 max-size-bytes=0 max-size-time=0 ! "
            
            # [C++] So khớp vector nhận diện của khuôn mặt với file nhị phân db.bin
            f"hailofilter so-path={db_matcher_post_so} name=db_matcher ! "
            f"queue name=queue_db_matcher max-size-buffers=3 max-size-bytes=0 max-size-time=0 ! "
            
            # [Python] Nơi đăng ký pad probe để vẽ các góc Sci-Fi lên khung hình thô
            f"videoconvert name=overlay ! "
            f"queue name=queue_overlay max-size-buffers=3 leaky=downstream max-size-bytes=0 max-size-time=0 ! "
            
            # [GStreamer] Hiển thị các thông tin hệ thống (FPS, CPU Temp, RAM,...) lên góc trên cùng
            f"textoverlay name=stats_overlay valignment=top halignment=left font-desc=\"Sans, 16\" ! "
            f"{display_str} " # Gửi khung hình cuối cùng ra màn hình hiển thị hoặc fakesink
            
            # [NHÁNH BYPASS]: Truyền khung hình gốc có gắn metadata đi thẳng đến bộ gộp luồng
            f"cropper.src_0 ! "
            f"queue name=queue_bypass max-size-buffers=3 leaky=downstream max-size-bytes=0 max-size-time=0 ! "
            f"agg.sink_0 "
            
            # [NHÁNH NHẬN DIỆN]: Lấy ảnh khuôn mặt đã cắt từ src_1
            f"cropper.src_1 ! "
            f"queue name=queue_crop_path max-size-buffers=30 max-size-bytes=0 max-size-time=0 ! "

            # Chuyển đổi định dạng kích thước chuẩn 112x112 RGB cho ArcFace
            f"video/x-raw, width=112, height=112, format=RGB ! "

            # [C++] Căn chỉnh khuôn mặt bằng 5 điểm landmark của YOLO (Affine Partial 2D)
            f"hailofilter so-path={face_align_so} use-gst-buffer=true ! "
            f"queue name=queue_align max-size-buffers=30 max-size-bytes=0 max-size-time=0 ! "

            # [NPU] Chạy mô hình trích xuất đặc trưng ArcFace (512 chiều) trên NPU
            f"hailonet hef-path={self.arcface_hef} vdevice-group-id=smart_door ! "
            f"queue name=queue_arcface max-size-buffers=30 max-size-bytes=0 max-size-time=0 ! "

            # [C++] Giải mã đặc trưng từ NPU sang đối tượng con HailoMatrix gắn vào khuôn mặt
            f"hailofilter so-path={arcface_post_so} ! "
            f"queue name=queue_filter2 max-size-buffers=30 max-size-bytes=0 max-size-time=0 ! "

            # Đưa đặc trưng nhận diện về bộ gộp luồng agg để ráp nối lại với khung hình gốc
            f"agg.sink_1"
        )

        logger.info(f"=== INITIALIZING GSTREAMER TAPPAS PIPELINE ({selected_name}) ===")
        try:
            self.pipeline = Gst.parse_launch(pipeline_str)
        except GLib.Error as e:
            logger.error(f"Failed to parse pipeline string: {e}")
            sys.exit(1)

        self.stats_overlay = self.pipeline.get_by_name("stats_overlay")

        # Register signal handlers if running in main thread
        import signal
        if threading.current_thread() is threading.main_thread():
            try:
                def sigint_handler(sig, frame):
                    logger.info("Force stopping pipeline and exiting...")
                    self.stop()
                signal.signal(signal.SIGINT, sigint_handler)
            except Exception as e:
                logger.warning(f"Could not register SIGINT handler: {e}")

        overlay = self.pipeline.get_by_name("overlay")
        if not overlay:
            logger.error("Could not find overlay element by name!")
            self.stop()

        pad = overlay.get_static_pad("sink")
        pad.add_probe(Gst.PadProbeType.BUFFER, self.on_new_frame_probe, None)

        # [CĂN CHỈNH] Căn chỉnh khuôn mặt hiện được thực hiện tự động bằng C++ plugin (libface_align.so)
        # tích hợp trực tiếp trong GStreamer pipeline trước queue_align. Không cần Python probe.

        if appsink_callback is not None:
            appsink = self.pipeline.get_by_name("appsink")
            if appsink:
                appsink.connect("new-sample", self.on_new_appsink_sample, appsink_callback)
                logger.info("[GStreamer] Connected appsink new-sample callback.")
            else:
                logger.warning("Could not find appsink element in pipeline.")

        ret = self.pipeline.set_state(Gst.State.PLAYING)
        if ret == Gst.StateChangeReturn.FAILURE:
            logger.error("Failed to transition pipeline to PLAYING state.")
            bus = self.pipeline.get_bus()
            msg = bus.timed_pop_filtered(2 * Gst.SECOND, Gst.MessageType.ERROR | Gst.MessageType.WARNING)
            if msg:
                err, debug = msg.parse_error()
                logger.error("================ GSTREAMER ERROR ================")
                logger.error(f"Error: {err.message}")
                logger.error(f"Debug Info: {debug}")
                logger.error("=================================================")
            else:
                logger.error("No error/warning message was received on the GStreamer bus.")
            self.stop()

        if appsink_callback is not None:
            logger.info("=== SYSTEM RUNNING IN GUI MODE (GLib loop in background thread) ===")
            # Start GLib MainLoop in a background daemon thread.
            # v4l2src and many GStreamer elements require the GLib event loop to
            # complete async PLAYING state transitions and begin delivering frames.
            self.loop = GLib.MainLoop()

            def _glib_loop():
                try:
                    self.loop.run()
                except Exception:
                    pass

            loop_thread = threading.Thread(target=_glib_loop, daemon=True, name="glib-main-loop")
            loop_thread.start()

            # Watch bus for errors (poll only — do NOT mix with add_signal_watch)
            def _bus_watcher():
                bus = self.pipeline.get_bus()
                while loop_thread.is_alive():
                    msg = bus.timed_pop_filtered(
                        1 * Gst.SECOND,
                        Gst.MessageType.ERROR | Gst.MessageType.WARNING | Gst.MessageType.STATE_CHANGED
                    )
                    if msg:
                        if msg.type == Gst.MessageType.ERROR:
                            err, debug = msg.parse_error()
                            logger.error(f"[Pipeline] GStreamer ERROR: {err.message}")
                            logger.error(f"[Pipeline] Debug: {debug}")
                        elif msg.type == Gst.MessageType.WARNING:
                            err, debug = msg.parse_warning()
                            logger.warning(f"[Pipeline] GStreamer WARNING: {err.message}")
                        elif msg.type == Gst.MessageType.STATE_CHANGED:
                            old, new, pending = msg.parse_state_changed()
                            if msg.src == self.pipeline:
                                logger.info(f"[Pipeline] State: {old.value_nick} -> {new.value_nick}")
            threading.Thread(target=_bus_watcher, daemon=True, name="gst-bus-watcher").start()
            return

        self.loop = GLib.MainLoop()
        logger.info("=== SYSTEM RUNNING — press Ctrl+C to quit ===")
        try:
            self.loop.run()
        except KeyboardInterrupt:
            pass
        finally:
            self.stop()

    def stop(self):
        logger.info("Stopping ProfessionalSmartDoor...")
        self._db_monitor_active = False
        try:
            self.stop_ir_camera()
        except Exception as e:
            logger.error(f"Failed to stop IR camera: {e}")
        if self.loop:
            try:
                self.loop.quit()
            except Exception:
                pass
        # Bypassing Gst.State.NULL to prevent the known dlclose() segfault on exit.
        # OS process termination handles resource release safely.
        os._exit(0)

