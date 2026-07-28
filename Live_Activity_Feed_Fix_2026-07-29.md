# Bug Fix Report: Dashboard Live Activity Feed & Confidence Values
**Date:** 2026-07-29

## 1. Problem Description
The USER reported that the Web App was not updating the "Live Activity Feed" table when faces were recognized (whether access was granted or denied). In addition, when events were logged, the confidence percentage displayed on the dashboard was incorrectly fixed at either 0.0% or 1.0% (interpreted from 1.0 confidence).

## 2. Root Cause Analysis
We discovered two distinct issues affecting the sync and display pipeline:

### Issue 1: Lab ID Mismatch causing empty Activity Feed
- `run_monitor.sh` was extracting the `lab_code` (e.g., `"304"`) from `lab_config.json` and exporting it as the `LAB_ID`.
- `sync_client.cpp` used this `LAB_ID` to push access events to the server endpoint `/api/labs/304/access-events`.
- The central Node/Flask backend blindly accepted the events and inserted them into the `access_events` table with `labId = "304"`.
- However, the Web App's `labStore` strictly tracks labs by their database primary key UUID, which for Lab 304 is `"default-lab"`.
- As a result, the React dashboard was polling `/api/labs/default-lab/access-events` for the Live Feed, missing all the new events stored under `"304"`.

### Issue 2: Hardcoded AI Confidence
- In `src/monitor_display/interface_monitor.py`, when a face was matched and logged into the SQLite edge DB, the `confidence` parameter was hardcoded to `1.0` (for success) and `0.0` (for unknown). 
- It completely ignored the actual inference confidence percentage calculated by the GStreamer pipeline `valid_user["confidence"]`.

## 3. Resolution Steps

### Fix 1: Properly passing `lab_id` for Sync Client
- **`src/lab_config.json`**: Added the `"lab_id": "default-lab"` field.
- **`run_monitor.sh`**: Modified the Bash script to extract `lab_id` instead of `lab_code`, and set the fallback default to `"default-lab"`. Now, `sync_client.cpp` will correctly push to the endpoint matching the web app's database query.

### Fix 2: Dynamic Confidence Extraction
- **`src/monitor_display/interface_monitor.py`**: Refactored the `handle_recognition_event` code block. It now actively queries the `confidence` value from the AI bounding boxes.
- Scaled the GStreamer NPU confidence metric (0.0 to 1.0) into a percentage scale (0.0 to 100.0) by multiplying by 100, which aligns perfectly with the Web Dashboard's `fmtConf` expectation.

## 4. Outcome
The C++ Sync client will now store all access events into the correct UUID partition, making them instantly visible on the Web App's Live Activity Feed. The Confidence Band will also reflect true and accurate AI probabilities!
