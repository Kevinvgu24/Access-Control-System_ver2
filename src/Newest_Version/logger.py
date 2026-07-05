import os
import logging
from logging.handlers import RotatingFileHandler

_initialized = False

def init_logging():
    """
    Khởi tạo cấu hình logging cho logger cha 'smart_door'.
    Tránh khởi tạo lại nhiều lần bằng cách sử dụng cờ _initialized toàn cục.
    """
    global _initialized
    if _initialized:
        return
    
    # Xác định cấp độ log từ môi trường (mặc định là INFO)
    env_level = os.environ.get("LOG_LEVEL", "INFO").upper()
    level_map = {
        "DEBUG": logging.DEBUG,
        "INFO": logging.INFO,
        "WARNING": logging.WARNING,
        "ERROR": logging.ERROR,
        "CRITICAL": logging.CRITICAL
    }
    log_level = level_map.get(env_level, logging.INFO)

    base_logger = logging.getLogger("smart_door")
    base_logger.setLevel(log_level)
    base_logger.propagate = False  # Ngăn chặn ghi log trùng lặp lên root logger

    # Định dạng log cho file (chi tiết hơn bao gồm tên file nguồn, hàm gọi và dòng lỗi)
    file_formatter = logging.Formatter(
        '%(asctime)s [%(levelname)s] (%(name)s:%(filename)s:%(lineno)d) - %(message)s'
    )

    # Định dạng log cho console (ngắn gọn, dễ đọc)
    console_formatter = logging.Formatter(
        '%(asctime)s [%(levelname)s] (%(name)s) - %(message)s'
    )

    # 1. Console Handler
    console_handler = logging.StreamHandler()
    console_handler.setLevel(log_level)
    console_handler.setFormatter(console_formatter)
    base_logger.addHandler(console_handler)

    # 2. Rotating File Handler
    current_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.abspath(os.path.join(current_dir, "..", ".."))
    log_dir = os.path.join(project_root, "logs")
    
    # Cấu hình dung lượng và số lượng file backup qua biến môi trường (mặc định: 10MB x 5 file = 50MB)
    try:
        max_bytes = int(os.environ.get("LOG_MAX_BYTES", 10 * 1024 * 1024))
        backup_count = int(os.environ.get("LOG_BACKUP_COUNT", 5))
    except ValueError:
        max_bytes = 10 * 1024 * 1024
        backup_count = 5

    try:
        os.makedirs(log_dir, exist_ok=True)
        log_file = os.path.join(log_dir, "system.log")
        
        file_handler = RotatingFileHandler(
            log_file, maxBytes=max_bytes, backupCount=backup_count, encoding="utf-8"
        )
        file_handler.setLevel(log_level)
        file_handler.setFormatter(file_formatter)
        base_logger.addHandler(file_handler)
    except Exception as e:
        print(f"[LOGGER WARNING] Failed to setup file logging in {log_dir}: {e}")

    _initialized = True

def get_logger(name):
    """
    Trả về một child logger của 'smart_door' (ví dụ: 'smart_door.app')
    """
    init_logging()
    return logging.getLogger(f"smart_door.{name}")
