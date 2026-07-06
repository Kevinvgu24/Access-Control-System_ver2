import gi
import time
gi.require_version('Gst', '1.0')
from gi.repository import Gst, GLib

def test_gst_pipeline():
    Gst.init(None)
    pipeline_str = (
        "v4l2src device=/dev/video0 ! "
        "image/jpeg, width=640, height=480, framerate=30/1 ! "
        "jpegdec ! videoconvert ! "
        "appsink name=sink emit-signals=true max-buffers=1 drop=true"
    )
    print(f"Testing GStreamer pipeline: {pipeline_str}")
    try:
        pipeline = Gst.parse_launch(pipeline_str)
        sink = pipeline.get_by_name("sink")
        
        frames_received = 0
        
        def on_new_sample(appsink):
            nonlocal frames_received
            sample = appsink.emit("pull-sample")
            if sample:
                frames_received += 1
                if frames_received % 10 == 0:
                    print(f"-> Received {frames_received} frames...")
            return Gst.FlowReturn.OK

        sink.connect("new-sample", on_new_sample)
        
        print("Setting pipeline to PLAYING state...")
        ret = pipeline.set_state(Gst.State.PLAYING)
        if ret == Gst.StateChangeReturn.FAILURE:
            print("[ERROR] Failed to set pipeline to PLAYING.")
            return

        print("Pipeline is PLAYING. Waiting 5 seconds to receive frames...")
        time.sleep(5.0)
        
        print("Stopping pipeline...")
        pipeline.set_state(Gst.State.NULL)
        
        print(f"=== TEST RESULT ===")
        if frames_received > 0:
            print(f"[SUCCESS] GStreamer successfully captured {frames_received} frames from /dev/video0!")
        else:
            print("[FAILED] GStreamer did not receive ANY frames from /dev/video0 (Timeout/Stall).")

    except Exception as e:
        print(f"Pipeline error: {e}")

if __name__ == "__main__":
    test_gst_pipeline()
