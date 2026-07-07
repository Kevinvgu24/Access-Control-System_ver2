import subprocess
import sys
import os

print("=== SYSTEM CAMERA DIAGNOSTIC ===")

# 1. Check video devices
try:
    video_devices = os.listdir('/dev')
    video_devices = [dev for dev in video_devices if dev.startswith('video')]
    print(f"Available video devices in /dev: {video_devices}")
except Exception as e:
    print(f"Error listing /dev: {e}")

# 2. Check if anything is holding /dev/video2
for dev in ['/dev/video2']:
    if os.path.exists(dev):
        try:
            res = subprocess.run(['fuser', dev], capture_output=True, text=True)
            if res.stdout.strip():
                print(f"{dev} is currently in use by PID(s): {res.stdout.strip()}")
            else:
                print(f"{dev} is free.")
        except Exception as e:
            print(f"Could not check fuser for {dev}: {e}")

# 3. Try to test GStreamer import and simple pipeline using /dev/video2
try:
    import gi
    gi.require_version('Gst', '1.0')
    from gi.repository import Gst, GLib
    Gst.init(None)
    
    # Try creating a simple pipeline to test opening /dev/video2
    pipeline_str = "v4l2src device=/dev/video2 ! fakesink"
    pipeline = Gst.parse_launch(pipeline_str)
    
    ret = pipeline.set_state(Gst.State.PLAYING)
    print(f"Pipeline state transition result: {ret}")
    
    if ret == Gst.StateChangeReturn.FAILURE:
        bus = pipeline.get_bus()
        msg = bus.timed_pop_filtered(2 * Gst.SECOND, Gst.MessageType.ERROR | Gst.MessageType.WARNING)
        if msg:
            err, debug = msg.parse_error()
            print("GSTREAMER PIPELINE ERROR DETECTED:")
            print(f"Message: {err.message}")
            print(f"Debug: {debug}")
        else:
            print("Pipeline failed but no error message was retrieved from the bus.")
    else:
        print("Pipeline successfully transitioned to PLAYING state.")
        pipeline.set_state(Gst.State.NULL)
        
except Exception as e:
    print(f"GStreamer Python test failed: {e}")
