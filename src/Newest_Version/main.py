import os
import argparse

# Đồng bộ hệ điều hành và tắt logging HailoRT
os.environ["LC_ALL"] = "C.UTF-8"
os.environ["LANG"] = "C.UTF-8"
os.environ["HAILORT_LOGGER_PATH"] = "NONE"

# Import não bộ hệ thống
from app import ProfessionalSmartDoor
from logger import get_logger

logger = get_logger("main")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Smart Lab Door System")
    parser.add_argument("--yolo_hef", type=str, required=True, help="Path to YOLO NPU model")
    parser.add_argument("--arcface_hef", type=str, required=True, help="Path to ArcFace NPU model")
    parser.add_argument("--anti_spoofing_hef", type=str, default="/home/kevinvgu/Access-Control-System_ver2/models/mobilenet_v3.hef", help="Path to Anti-Spoofing NPU model")
    parser.add_argument("--db_dir", type=str, required=True, help="Directory containing SQLite Database")
    parser.add_argument("--lbf_model", type=str, required=True, help="Path to LBF OpenCV model config")
    parser.add_argument("--close_thresh", type=int, default=130, help="Face close distance threshold (pixels)")
    parser.add_argument("--cam_width", type=int, default=640, help="Camera frame width resolution")
    parser.add_argument("--cam_height", type=int, default=480, help="Camera frame height resolution")
    args = parser.parse_args()
    
    # Khởi tạo và chạy
    app = ProfessionalSmartDoor(
        args.yolo_hef,
        args.arcface_hef,
        args.anti_spoofing_hef,
        args.lbf_model,
        args.db_dir,
        close_thresh=args.close_thresh
    )
    app.run(width=args.cam_width, height=args.cam_height)
