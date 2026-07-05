#!/usr/bin/env python3
import os
import sys
import time
import argparse
import numpy as np
import cv2
import ctypes

# Import GStreamer and GLib
try:
    import gi
    gi.require_version('Gst', '1.0')
    from gi.repository import Gst, GLib
except ImportError:
    print("Error: PyGObject (gi) or GStreamer bindings not found.")
    print("Please install via: sudo apt-get install python3-gi gstreamer1.0-tools python3-gst-1.0")
    sys.exit(1)

# Define GstMapInfo for zero-copy mapping
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

# Try to load libgstreamer
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

def build_pipeline(source, width, height, grayscale):
    # Determine the source element
    if source.startswith("/dev/video") or source.isdigit():
        device = f"/dev/video{source}" if source.isdigit() else source
        src_element = f"v4l2src device={device} ! videoconvert ! videoscale"
    else:
        src_element = "libcamerasrc ! videoconvert ! videoscale"

    format_str = "GRAY8" if grayscale else "BGR"
    
    # Construct the pipeline
    pipeline_str = (
        f"{src_element} ! "
        f"video/x-raw, width={width}, height={height}, format={format_str} ! "
        f"appsink name=appsink sync=false max-buffers=1 drop=true emit-signals=true"
    )
    return pipeline_str

def main():
    parser = argparse.ArgumentParser(description="Test Script for RPi NoIR Camera")
    parser.add_argument("--source", type=str, default="libcamerasrc", 
                        help="Camera source: 'libcamerasrc' (default for CSI slot) or a device index/path (e.g. '0', '/dev/video0')")
    parser.add_argument("--width", type=int, default=640, help="Frame width (default: 640)")
    parser.add_argument("--height", type=int, default=480, help="Frame height (default: 480)")
    parser.add_argument("--gray", action="store_true", help="Capture in grayscale (GRAY8) instead of color (BGR)")
    parser.add_argument("--output", type=str, default="noir_test_capture.jpg", help="Path to save the test image")
    parser.add_argument("--duration", type=int, default=10, help="Duration to run the live test in seconds (default: 10)")
    args = parser.parse_args()

    # ANSI Colors
    GREEN = "\033[92m"
    YELLOW = "\033[93m"
    RED = "\033[91m"
    BLUE = "\033[94m"
    RESET = "\033[0m"

    print(f"{BLUE}=================================================={RESET}")
    print(f"{BLUE}         RPi NoIR Camera Testing Tool             {RESET}")
    print(f"{BLUE}=================================================={RESET}")
    print(f"Source:     {GREEN}{args.source}{RESET}")
    print(f"Resolution: {GREEN}{args.width}x{args.height}{RESET}")
    print(f"Format:     {GREEN}{'Grayscale (GRAY8)' if args.gray else 'Color (BGR)'}{RESET}")
    print(f"Save Path:  {GREEN}{args.output}{RESET}")
    print(f"--------------------------------------------------")

    # Initialize GStreamer
    Gst.init(None)

    pipeline_str = build_pipeline(args.source, args.width, args.height, args.gray)
    print(f"GStreamer Pipeline:\n  {YELLOW}{pipeline_str}{RESET}\n")

    try:
        pipeline = Gst.parse_launch(pipeline_str)
    except GLib.Error as e:
        print(f"{RED}[ERROR] GStreamer parsing failed: {e}{RESET}")
        print("Make sure gstreamer plugins and libcamerasrc are installed.")
        sys.exit(1)

    appsink = pipeline.get_by_name("appsink")
    if not appsink:
        print(f"{RED}[ERROR] Appsink not found in pipeline!{RESET}")
        sys.exit(1)

    # Frame tracking variables
    frame_data = {"count": 0, "last_frame": None}
    has_display = "DISPLAY" in os.environ
    loop = GLib.MainLoop()

    # Callback for appsink new-sample signal
    def on_new_sample(sink):
        sample = sink.emit("pull-sample")
        if not sample:
            return Gst.FlowReturn.OK
        
        buffer = sample.get_buffer()
        if not buffer:
            return Gst.FlowReturn.OK

        # Try to map and copy buffer data
        if libgst:
            buf_ptr = hash(buffer)
            map_info = GstMapInfo()
            if libgst.gst_buffer_map(buf_ptr, ctypes.byref(map_info), 1):
                try:
                    data_ptr = ctypes.cast(map_info.data, ctypes.POINTER(ctypes.c_ubyte))
                    channels = 1 if args.gray else 3
                    
                    if args.gray:
                        shape = (args.height, args.width)
                    else:
                        shape = (args.height, args.width, channels)
                        
                    arr = np.ctypeslib.as_array(data_ptr, shape=shape).copy()
                    frame_data["last_frame"] = arr
                    frame_data["count"] += 1
                    
                    if frame_data["count"] % 15 == 1:
                        print(f"-> Captured frame #{frame_data['count']} successfully. Shape: {arr.shape}")
                except Exception as e:
                    print(f"{RED}[ERROR] Frame array mapping error: {e}{RESET}")
                finally:
                    libgst.gst_buffer_unmap(buf_ptr, ctypes.byref(map_info))
        else:
            # Fallback (non-ctypes, slower but safer if CDLL fails)
            success, map_info = buffer.map(Gst.MapFlags.READ)
            if success:
                try:
                    channels = 1 if args.gray else 3
                    arr = np.frombuffer(map_info.data, dtype=np.uint8)
                    if args.gray:
                        arr = arr.reshape((args.height, args.width))
                    else:
                        arr = arr.reshape((args.height, args.width, channels))
                    frame_data["last_frame"] = arr.copy()
                    frame_data["count"] += 1
                    if frame_data["count"] % 15 == 1:
                        print(f"-> Captured frame #{frame_data['count']} (fallback). Shape: {arr.shape}")
                except Exception as e:
                    print(f"{RED}[ERROR] Buffer map fallback error: {e}{RESET}")
                finally:
                    buffer.unmap(map_info)

        # In headless mode, stop after getting 15 frames to complete the test
        if not has_display and frame_data["count"] >= 15:
            GLib.idle_add(loop.quit)

        return Gst.FlowReturn.OK

    appsink.connect("new-sample", on_new_sample)

    # If display is present, run GUI update in GLib timer
    def update_gui():
        if has_display and frame_data["last_frame"] is not None:
            cv2.imshow("NoIR Camera Test Feed", frame_data["last_frame"])
            key = cv2.waitKey(1) & 0xFF
            if key in [ord('q'), 27]: # 'q' or ESC
                print("Exiting test early due to user key press.")
                loop.quit()
                return False # Stop timer
        return True # Continue timer

    if has_display:
        GLib.timeout_add(30, update_gui)

    # Safety timeout to stop loop after duration
    def on_timeout():
        print(f"Test duration ({args.duration}s) reached.")
        loop.quit()
        return False # Stop timer

    GLib.timeout_add_seconds(args.duration, on_timeout)

    # Start playing pipeline
    print(f"Starting camera pipeline...")
    ret = pipeline.set_state(Gst.State.PLAYING)
    if ret == Gst.StateChangeReturn.FAILURE:
        print(f"{RED}[ERROR] Failed to start pipeline. Details:{RESET}")
        bus = pipeline.get_bus()
        msg = bus.pop_filtered(Gst.MessageType.ERROR, 0)
        if msg:
            err, debug = msg.parse_error()
            print(f"  Error msg: {err.message}")
            print(f"  Debug info: {debug}")
        else:
            print("  No GStreamer bus error returned.")
        sys.exit(1)

    print(f"{GREEN}Pipeline is now PLAYING.{RESET}")
    if has_display:
        print(f"Display detected. Showing live window. Press 'q' or Esc to close.")
    else:
        print(f"No display detected (headless mode). Running to capture frames...")

    try:
        loop.run()
    except KeyboardInterrupt:
        print("\nTest cancelled by user.")

    # Stop pipeline
    print("\nStopping camera pipeline...")
    pipeline.set_state(Gst.State.NULL)

    # Save and summarize results
    print(f"--------------------------------------------------")
    if frame_data["count"] > 0 and frame_data["last_frame"] is not None:
        print(f"{GREEN}SUCCESS: Camera is WORKING!{RESET}")
        print(f"Total frames received: {frame_data['count']}")
        
        # Save last captured frame
        try:
            cv2.imwrite(args.output, frame_data["last_frame"])
            abs_output = os.path.abspath(args.output)
            print(f"Saved last frame to: {YELLOW}{abs_output}{RESET}")
        except Exception as e:
            print(f"{RED}[ERROR] Failed to save frame: {e}{RESET}")
    else:
        print(f"{RED}FAILED: No frames were received from the camera.{RESET}")
        print(f"Suggestions:")
        print(f"  1. Ensure the camera ribbon cable is firmly connected to the CSI slot.")
        print(f"  2. Check if another process is using the camera (e.g. main door control app).")
        print(f"  3. Run 'libcamera-hello' or 'vcgencmd get_camera' to check OS-level hardware detection.")
        print(f"  4. Make sure the camera is enabled in raspi-config or /boot/firmware/config.txt.")
    print(f"{BLUE}=================================================={RESET}")

if __name__ == "__main__":
    main()
