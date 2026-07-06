import subprocess

def get_formats():
    try:
        output = subprocess.check_output(["v4l2-ctl", "-d", "/dev/video0", "--list-formats-ext"]).decode("utf-8")
        print("=== v4l2-ctl -d /dev/video0 --list-formats-ext ===")
        print(output)
    except Exception as e:
        print(f"Failed to list formats for /dev/video0: {e}")

if __name__ == "__main__":
    get_formats()
