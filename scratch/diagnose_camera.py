#!/usr/bin/env python3
import os
import sys
import subprocess
import shutil

def run_cmd(cmd):
    try:
        res = subprocess.run(cmd, shell=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        return res.stdout.strip(), res.stderr.strip(), res.returncode
    except Exception as e:
        return "", str(e), -1

def main():
    print("==================================================")
    print("          CAMERA DIAGNOSTIC UTILITY               ")
    print("==================================================")
    
    # 1. Check OS
    print("\n1. OS Info:")
    if os.path.exists("/etc/os-release"):
        with open("/etc/os-release") as f:
            for line in f:
                if line.startswith("PRETTY_NAME="):
                    print("  OS Name: ", line.split("=")[1].strip().strip('"'))
    else:
        print("  OS Name: Unknown")
        
    # 2. Check PATH
    print("\n2. Environment & PATH:")
    print("  Python Executable:", sys.executable)
    print("  PATH Env Variable:", os.environ.get("PATH", ""))
    
    # 3. Check installed packages (Debian/Ubuntu specific)
    print("\n3. Installed GStreamer/Libcamera packages:")
    packages_to_check = [
        "gstreamer1.0-libcamera",
        "libcamera-apps",
        "libcamera-apps-lite",
        "libcamera-tools",
        "libcamera0",
        "gstreamer1.0-plugins-good",
        "gstreamer1.0-plugins-bad",
        "gstreamer1.0-tools"
    ]
    for pkg in packages_to_check:
        out, err, code = run_cmd(f"dpkg -s {pkg} 2>/dev/null | grep -E '^Package:|^Status:'")
        if code == 0:
            cleaned = out.replace('\n', ' | ')
            print(f"  - {pkg}: Installed ({cleaned})")
        else:
            print(f"  - {pkg}: NOT installed")

    # 4. Check GStreamer elements
    print("\n4. GStreamer Element Verification:")
    try:
        import gi
        gi.require_version('Gst', '1.0')
        from gi.repository import Gst
        Gst.init(None)
        
        # Check for libcamerasrc
        factory = Gst.ElementFactory.find("libcamerasrc")
        if factory:
            print("  - 'libcamerasrc' element: FOUND")
        else:
            print("  - 'libcamerasrc' element: NOT FOUND")
            
        # Check for v4l2src
        factory_v4l2 = Gst.ElementFactory.find("v4l2src")
        if factory_v4l2:
            print("  - 'v4l2src' element: FOUND")
        else:
            print("  - 'v4l2src' element: NOT FOUND")
    except Exception as e:
        print("  - Error importing GStreamer Python bindings:", e)

    # 5. Check if camera is detected by libcamera library (using gst-inspect-1.0 or system tools if available)
    print("\n5. Searching for libcamera-hello / libcamera-still binary path:")
    for binary in ["libcamera-hello", "libcamera-still"]:
        path = shutil.which(binary)
        if path:
            print(f"  - {binary} absolute path: {path}")
            # Try to run with --list-cameras
            out, err, code = run_cmd(f"{path} --list-cameras")
            print(f"  - {binary} --list-cameras output:")
            print(out if out else err)
        else:
            print(f"  - {binary}: Not found in system PATH")

    # Let's search standard locations just in case PATH is messed up in the virtualenv
    print("\n6. Searching standard binary directories (/usr/bin, /usr/local/bin, /sbin):")
    std_dirs = ["/usr/bin", "/usr/local/bin", "/usr/sbin", "/sbin"]
    found_any = False
    for d in std_dirs:
        if os.path.exists(d):
            try:
                for f in os.listdir(d):
                    if "libcamera" in f:
                        print(f"  - Found in {d}: {f}")
                        found_any = True
            except PermissionError:
                pass
    if not found_any:
        print("  - No libcamera related binaries found in standard search paths.")

    print("\n==================================================")

if __name__ == "__main__":
    main()
