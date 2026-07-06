import cv2
import subprocess
import os

def get_video_devices():
    try:
        output = subprocess.check_output(["v4l2-ctl", "--list-devices"]).decode("utf-8")
        print("=== v4l2-ctl --list-devices ===")
        print(output)
        return output
    except Exception as e:
        print(f"v4l2-ctl is not installed or failed: {e}")
        return ""

def test_camera_opencv():
    print("=== Testing OpenCV VideoCapture ===")
    for i in range(15):
        cap = cv2.VideoCapture(i)
        if cap.isOpened():
            ret, frame = cap.read()
            w = cap.get(cv2.CAP_PROP_FRAME_WIDTH)
            h = cap.get(cv2.CAP_PROP_FRAME_HEIGHT)
            backend = cap.getBackendName()
            print(f"[{i}]: Opened successfully! Resolution: {w}x{h}, Backend: {backend}, Frame read: {ret}")
            cap.release()
        else:
            if os.path.exists(f"/dev/video{i}"):
                print(f"[{i}]: /dev/video{i} exists but could not be opened by OpenCV.")

if __name__ == "__main__":
    get_video_devices()
    test_camera_opencv()
