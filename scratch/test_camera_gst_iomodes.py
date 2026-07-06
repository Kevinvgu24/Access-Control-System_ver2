import gi
import time
gi.require_version('Gst', '1.0')
from gi.repository import Gst, GLib

def test_pipeline(pipeline_str, desc):
    print(f"\n=====================================")
    print(f"Testing: {desc}")
    print(f"Pipeline: {pipeline_str}")
    Gst.init(None)
    try:
        pipeline = Gst.parse_launch(pipeline_str)
        sink = pipeline.get_by_name("sink")
        
        frames_received = 0
        
        def on_new_sample(appsink):
            nonlocal frames_received
            sample = appsink.emit("pull-sample")
            if sample:
                frames_received += 1
            return Gst.FlowReturn.OK

        sink.connect("new-sample", on_new_sample)
        
        pipeline.set_state(Gst.State.PLAYING)
        
        # Wait 3 seconds to see if frames flow
        time.sleep(3.0)
        
        pipeline.set_state(Gst.State.NULL)
        
        if frames_received > 0:
            print(f"[SUCCESS] Got {frames_received} frames!")
            return True
        else:
            print("[FAILED] No frames received.")
            return False
    except Exception as e:
        print(f"[ERROR] Pipeline error: {e}")
        return False

def main():
    # Candidate 1: MJPG with default mmap (already failed, re-testing)
    p1 = "v4l2src device=/dev/video0 ! image/jpeg, width=640, height=480, framerate=30/1 ! jpegdec ! videoconvert ! appsink name=sink emit-signals=true max-buffers=1 drop=true"
    
    # Candidate 2: MJPG with Read/Write mode (bypasses mmap)
    p2 = "v4l2src device=/dev/video0 io-mode=rw ! image/jpeg, width=640, height=480, framerate=30/1 ! jpegdec ! videoconvert ! appsink name=sink emit-signals=true max-buffers=1 drop=true"
    
    # Candidate 3: Raw YUYV with Read/Write mode (simplest raw path, no jpegdec)
    p3 = "v4l2src device=/dev/video0 io-mode=rw ! video/x-raw, width=640, height=480, framerate=30/1 ! videoconvert ! appsink name=sink emit-signals=true max-buffers=1 drop=true"
    
    # Candidate 4: Raw YUYV with mmap
    p4 = "v4l2src device=/dev/video0 io-mode=mmap ! video/x-raw, width=640, height=480, framerate=30/1 ! videoconvert ! appsink name=sink emit-signals=true max-buffers=1 drop=true"

    test_pipeline(p1, "MJPG + io-mode=default")
    test_pipeline(p2, "MJPG + io-mode=rw (Read/Write)")
    test_pipeline(p3, "Raw YUYV + io-mode=rw (Read/Write)")
    test_pipeline(p4, "Raw YUYV + io-mode=mmap")

if __name__ == "__main__":
    main()
