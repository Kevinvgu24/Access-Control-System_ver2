import cv2
import numpy as np
import ctypes
import os
from logger import get_logger

logger = get_logger("anti_spoofing")

# ── CTYPES CONFIGURATION TO LOAD C++ SHARED LIBRARY ──────────────────────────
lib_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "Native_Tappas_CPP", "build", "libanti_spoofing.so"))
lib = None

class LivenessResult(ctypes.Structure):
    _fields_ = [
        ("is_live", ctypes.c_bool),
        ("score", ctypes.c_float),
        ("reason", ctypes.c_char * 128)
    ]

if os.path.exists(lib_path):
    try:
        lib = ctypes.CDLL(lib_path)
        lib.check_liveness_cpp.argtypes = [
            ctypes.POINTER(ctypes.c_uint8),  # img_data
            ctypes.c_int,                    # width
            ctypes.c_int,                    # height
            ctypes.c_int,                    # step
            ctypes.POINTER(ctypes.c_float),  # landmarks
            ctypes.c_int,                    # num_landmarks
            ctypes.c_float,                  # min_contrast_ratio
            ctypes.c_float,                  # min_blur_var
            ctypes.c_float,                  # max_blur_var
            ctypes.c_float,                  # max_hotspot_ratio
            ctypes.c_float                   # min_radial_ratio
        ]
        lib.check_liveness_cpp.restype = LivenessResult
        logger.info("[IR Liveness] Loaded C++ anti-spoofing library successfully.")
    except Exception as e:
        logger.error(f"[IR Liveness] Failed to load C++ library: {e}.")
        raise ImportError(f"Could not load C++ anti-spoofing library: {e}")
else:
    logger.error("[IR Liveness] C++ library not found. Please compile it first.")
    raise FileNotFoundError("libanti_spoofing.so not found. Compile it inside src/Native_Tappas_CPP/build.")


class IRLivenessDetector:
    def __init__(self, min_contrast_ratio=1.20, min_blur_var=15.0, max_blur_var=1000.0, max_hotspot_ratio=0.02, min_radial_ratio=1.30):
        self.min_contrast_ratio = min_contrast_ratio
        self.min_blur_var = min_blur_var
        self.max_blur_var = max_blur_var
        self.max_hotspot_ratio = max_hotspot_ratio
        self.min_radial_ratio = min_radial_ratio

    def check_liveness(self, ir_face_crop, landmarks=None):
        """
        Check liveness. Executes ONLY using the optimized C++ compiled library.
        """
        if ir_face_crop is None or ir_face_crop.size == 0:
            logger.warning("IR Liveness: Empty crop received.")
            return False, 0.0, "Empty crop"

        if lib is None:
            raise RuntimeError("C++ anti-spoofing library is not initialized.")

        # Ensure 2D grayscale
        if len(ir_face_crop.shape) > 2:
            ir_face_crop = cv2.cvtColor(ir_face_crop, cv2.COLOR_BGR2GRAY)
        
        h, w = ir_face_crop.shape[:2]
        ir_face_crop = np.ascontiguousarray(ir_face_crop, dtype=np.uint8)
        
        # Pointers
        img_data_ptr = ir_face_crop.ctypes.data_as(ctypes.POINTER(ctypes.c_uint8))
        step = ir_face_crop.strides[0]

        landmarks_ptr = None
        num_landmarks = 0
        if landmarks is not None and len(landmarks) == 5:
            flat_landmarks = np.array(landmarks, dtype=np.float32).flatten()
            landmarks_ptr = flat_landmarks.ctypes.data_as(ctypes.POINTER(ctypes.c_float))
            num_landmarks = 5

        # Call C++
        res = lib.check_liveness_cpp(
            img_data_ptr, w, h, step,
            landmarks_ptr, num_landmarks,
            float(self.min_contrast_ratio),
            float(self.min_blur_var),
            float(self.max_blur_var),
            float(self.max_hotspot_ratio),
            float(self.min_radial_ratio)
        )
        reason_str = res.reason.decode('utf-8', errors='ignore')
        return res.is_live, float(res.score), reason_str
