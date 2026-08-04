import os
import json
import time
import sqlite3
import urllib.request
import urllib.error
from typing import Dict, Any, List, Optional
from logger import get_logger

logger = get_logger("ai_assistant")

current_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.abspath(os.path.join(current_dir, "..", ".."))

class QwenAIAssistant:
    def __init__(self, db_path: str = "database/smart_door.db", schema_path: str = "src/Newest_Version/app_schema.json"):
        self.db_path = db_path
        if not os.path.exists(self.db_path) and os.path.exists("smart_door.db"):
            self.db_path = "smart_door.db"
            
        self.schema_path = schema_path
        if not os.path.exists(self.schema_path) and os.path.exists("app_schema.json"):
            self.schema_path = "app_schema.json"

        self.api_base = os.getenv("QWEN_API_BASE", "http://localhost:11434/v1").rstrip("/")
        self.model_name = os.getenv("QWEN_MODEL_NAME", "qwen2.5-coder:1.5b")
        self.api_key = os.getenv("QWEN_API_KEY", "ollama")

        # Load App Architecture Schema (Sơ đồ tri thức)
        self.app_schema = self._load_app_schema()

        # Deep-Layer In-Memory Cache for Zero-Latency RAG
        self._memory_cache: Dict[str, Any] = {}
        self._last_cache_update: float = 0.0
        self._cache_ttl_seconds: float = 15.0  # Auto-refresh every 15s

        # Initialize cache snapshot
        self.sync_db_cache(force=True)

    def _load_app_schema(self) -> Dict[str, Any]:
        """
        Load App Architecture Schema from app_routes_permissions.json or app_schema.json
        """
        candidate_paths = [
            os.path.join(project_root, "web_app", "public", "app_routes_permissions.json"),
            os.path.join(project_root, "web_app", "src", "config", "app_routes_permissions.json"),
            os.path.join(project_root, "src", "Newest_Version", "app_routes_permissions.json"),
            os.path.join(project_root, "src", "Newest_Version", "app_schema.json"),
            self.schema_path
        ]
        
        for p in candidate_paths:
            if os.path.exists(p):
                try:
                    with open(p, "r", encoding="utf-8") as f:
                        data = json.load(f)
                        logger.info(f"Successfully loaded app schema/roadmap from: {p}")
                        return data
                except Exception as e:
                    logger.error(f"Error loading schema file from {p}: {e}")
        
        # Fallback Schema
        return {
            "app_name": "Access Control System v2",
            "navigation_routes": [
                {"feature": "Quản lý Thiết bị & Linh kiện", "route": "/equipment", "keywords": ["thiết bị", "linh kiện", "mượn", "trả"]},
                {"feature": "Lịch học & Thời khóa biểu", "route": "/schedules", "keywords": ["lịch", "thời khóa biểu", "tiết"]},
                {"feature": "Nhật ký Check-in FaceID", "route": "/logs", "keywords": ["checkin", "log", "ra vào", "faceid"]},
                {"feature": "Quản lý Người dùng", "route": "/users", "keywords": ["người dùng", "sinh viên", "giảng viên"]},
                {"feature": "Đăng ký Sinh trắc học", "route": "/enrollment", "keywords": ["đăng ký", "nạp face", "pin"]},
                {"feature": "Cấu hình Trạm cửa", "route": "/system", "keywords": ["trạm", "rpi5", "cấu hình"]},
                {"feature": "Tổng quan Dashboard", "route": "/overview", "keywords": ["tổng quan", "dashboard", "phòng lab"]}
            ]
        }

    def check_status(self) -> Dict[str, Any]:
        """
        Check connection status to Qwen 2.5 Coder local API endpoint.
        """
        models_url = f"{self.api_base}/models"
        try:
            req = urllib.request.Request(models_url)
            if self.api_key:
                req.add_header("Authorization", f"Bearer {self.api_key}")
            
            with urllib.request.urlopen(req, timeout=5) as resp:
                if resp.status == 200:
                    data = json.loads(resp.read().decode('utf-8'))
                    return {
                        "status": "online",
                        "model": self.model_name,
                        "api_base": self.api_base,
                        "available_models": [m.get("id") for m in data.get("data", [])] if "data" in data else []
                    }
        except Exception as e:
            logger.debug(f"Qwen API status check failed: {e}")
            
        return {
            "status": "offline",
            "model": self.model_name,
            "api_base": self.api_base,
            "error": "Cannot connect to Qwen 2.5 Coder LLM service. Ensure Ollama is running."
        }

    def _get_db_connection(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def invalidate_cache(self):
        """
        Call this whenever database mutations occur to invalidate cache immediately.
        """
        self._last_cache_update = 0.0

    def sync_db_cache(self, force: bool = False):
        """
        Synchronize full in-memory snapshot of ALL SQLite DB tables and columns.
        """
        now = time.time()
        if not force and (now - self._last_cache_update) < self._cache_ttl_seconds:
            return

        try:
            conn = self._get_db_connection()
            c = conn.cursor()

            # 1. Labs Snapshot (with Manager, Code, Location, Status)
            c.execute("SELECT id, name, code, location, manager, status FROM labs")
            lab_rows = c.fetchall()
            labs_list = [
                f"Phòng: '{r['name']}' | Mã: {r['code']} | Quản lý: {r['manager'] or 'N/A'} | Vị trí: {r['location'] or 'N/A'} | Trạng thái: {r['status']}"
                for r in lab_rows
            ]
            active_labs_cnt = sum(1 for r in lab_rows if r['status'] == 'active')

            # 2. Nodes Snapshot (Door Hardware Devices)
            c.execute("SELECT id, name, code, deviceId, location, status, onlineState FROM nodes")
            node_rows = c.fetchall()
            nodes_list = [
                f"Trạm: '{r['name']}' | Mã: {r['code']} | Vị trí: {r['location']} | Trạng thái: {r['status']} ({r['onlineState']})"
                for r in node_rows
            ]

            # 3. Users Snapshot
            c.execute("SELECT id, name, university_id, email, role, status, faceStatus, pinStatus FROM users LIMIT 30")
            u_rows = c.fetchall()
            users_list = [
                f"Người dùng: '{r['name']}' | MSSV/Mã: {r['university_id'] or r['id']} | Email: {r['email'] or 'N/A'} | Vai trò: {r['role']} | Trạng thái: {r['status']} | FaceID: {r['faceStatus']}"
                for r in u_rows
            ]

            # 4. Equipment & Borrowing Snapshot per Lab
            try:
                c.execute("SELECT name, code, category, status, borrowedByName, borrowerId, borrowDate, dueDate, location FROM equipment")
                eq_rows = c.fetchall()
            except Exception:
                c.execute("SELECT name, serialNumber as code, category, status, borrowerName as borrowedByName, borrowerId, borrowDate, returnDate as dueDate, location FROM lab_equipment")
                eq_rows = c.fetchall()

            equipment_list = []
            overdue_list = []
            for r in eq_rows:
                status_str = f"Thiết bị: '{r['name']}' [Mã: {r['code'] or 'N/A'}, Phòng/Vị trí: {r['location'] or 'Main Lab'}, Loại: {r['category'] or 'Module'}, Trạng thái: {r['status']}]"
                if r['borrowedByName']:
                    status_str += f" (Người mượn: {r['borrowedByName']} [Mã: {r['borrowerId'] or 'N/A'}], Hạn trả: {r['dueDate'] or 'N/A'})"
                equipment_list.append(status_str)
                if r['status'] in ['overdue', 'Overdue']:
                    overdue_list.append(f"'{r['name']}' tại {r['location'] or 'Main Lab'} (Người mượn: {r['borrowedByName']}, Hạn trả: {r['dueDate']})")

            # 5. Access Events Snapshot (Recent 10 Logs)
            c.execute("SELECT userName, accessMethod, status, isAuthorized, timestamp FROM access_events ORDER BY id DESC LIMIT 10")
            log_rows = c.fetchall()
            logs_list = [
                f"Log Check-in: '{r['userName']}' | Phương thức: {r['accessMethod']} | Trạng thái: {r['status']} | Cho phép: {r['isAuthorized']} | Thời gian: {r['timestamp']}"
                for r in log_rows
            ]

            # 6. Schedules & Timetables Snapshot
            c.execute("SELECT title, room, instructor, dayOfWeek, startTime, endTime FROM schedules LIMIT 10")
            sch_rows = c.fetchall()
            schedules_list = [
                f"Lịch học: '{r['title']}' | Phòng: {r['room']} | Giảng viên: {r['instructor']} | Thứ: {r['dayOfWeek']} {r['startTime']}-{r['endTime']}"
                for r in sch_rows
            ]

            # 7. Security Incidents Snapshot
            c.execute("SELECT type, severity, status, summary, createdAt FROM incidents ORDER BY id DESC LIMIT 5")
            inc_rows = c.fetchall()
            incidents_list = [
                f"Sự cố: '{r['type']}' [{r['severity']}] | Trạng thái: {r['status']} | Nội dung: {r['summary']} | Thời gian: {r['createdAt']}"
                for r in inc_rows
            ]

            conn.close()

            self._memory_cache = {
                "labs_summary": labs_list,
                "total_labs": len(labs_list),
                "active_labs_count": active_labs_cnt,
                "nodes_summary": nodes_list,
                "users_summary": users_list,
                "total_users": len(users_list),
                "equipment_summary": equipment_list,
                "available_equipment_count": len([e for e in eq_rows if str(e['status']).lower() in ['available', 'khả dụng', 'sẵn sàng']]),
                "total_equipment_count": len(eq_rows),
                "overdue_items": overdue_list,
                "recent_logs": logs_list[:5],
                "schedules_summary": schedules_list,
                "incidents_summary": incidents_list[:5],
                "synced_at": time.strftime("%H:%M:%S")
            }
            self._last_cache_update = now
        except Exception as e:
            logger.error(f"Error syncing DB in-memory cache: {e}")

    def _search_knowledge_docs(self, user_prompt: str) -> str:
        """
        Lightweight RAG search across workspace Markdown documentation files for technical specs & guides.
        """
        prompt_lower = user_prompt.lower()
        relevant_snippets = []
        doc_files = ["MQTT_sensor/Sensor_Connection_Guide.md", "README_DEPLOY.md", "SECURITY_REPORT.md", "pipeline_architecture.md", "technical.md"]
        
        for doc_rel_path in doc_files:
            doc_full_path = os.path.join(project_root, doc_rel_path)
            if os.path.exists(doc_full_path):
                try:
                    with open(doc_full_path, "r", encoding="utf-8", errors="ignore") as f:
                        lines = f.readlines()
                    matched_lines = [l.strip() for l in lines if any(k in l.lower() for k in prompt_lower.split() if len(k) > 3)]
                    if matched_lines:
                        relevant_snippets.append(f"--- Doc '{doc_rel_path}' ---\n" + "\n".join(matched_lines[:4]))
                except Exception as e:
                    logger.debug(f"Error reading doc {doc_rel_path}: {e}")
                    
        return "\n".join(relevant_snippets[:3]) if relevant_snippets else ""

    def build_router_map_text(self) -> str:
        """
        Format Router Map from app_routes_permissions.json or app_schema.json into clear Markdown links list
        """
        routes = self.app_schema.get("routes") or self.app_schema.get("navigation_routes") or []
        lines = []
        for r in routes:
            title = r.get("title") or r.get("title_vi") or r.get("feature") or r.get("page_key") or "Page"
            path = r.get("path") or r.get("route") or "/"
            desc = r.get("description", "")
            roles = r.get("allowed_roles", [])
            role_str = f" [Roles: {', '.join(roles)}]" if roles else ""
            lines.append(f"- [{title}]({path}){role_str}: {desc}")
        return "\n".join(lines)

    def detect_navigation_intent(self, user_prompt: str) -> tuple[Optional[str], Optional[str]]:
        """
        Detect if the user wants to navigate to a specific page on the web app.
        Returns (action, target_route)
        """
        prompt_lower = user_prompt.lower()
        nav_verbs = ["mở", "chuyển", "đến", "trỏ", "vào", "xem", "open", "go to", "navigate", "show me", "take me to", "bật", "truy cập"]
        
        route_keywords = [
            ("/equipment", ["thiết bị", "linh kiện", "mượn", "trả", "vật tư", "máy móc", "equipment", "asset", "dụng cụ", "kho"]),
            ("/users", ["người dùng", "sinh viên", "giảng viên", "tài khoản", "mssv", "phân quyền", "users", "student", "thành viên"]),
            ("/enrollment", ["đăng ký", "nạp face", "sinh trắc", "mã pin", "chụp ảnh", "enroll", "biometric", "nhận diện"]),
            ("/schedules", ["lịch", "thời khóa biểu", "ca làm", "tiết", "lớp", "schedule", "timetable", "giờ mở cửa"]),
            ("/logs", ["nhật ký", "log", "checkin", "ra vào", "điểm danh", "faceid log", "audit", "lịch sử"]),
            ("/system", ["trạm", "rpi5", "hailo", "phần cứng", "cấu hình", "cài đặt", "system", "node", "hardware", "ngưỡng"]),
            ("/overview", ["tổng quan", "dashboard", "bảng điều khiển", "overview", "trang chủ"]),
            ("/labs", ["phòng lab", "chọn lab", "chuyển lab", "labs"])
        ]

        if any(verb in prompt_lower for verb in nav_verbs):
            for route, keywords in route_keywords:
                if any(kw in prompt_lower for kw in keywords):
                    return ("NAVIGATE", route)

        return (None, None)

    def extract_realtime_snapshot(self, user_prompt: str = "", current_page: str = "overview") -> Dict[str, Any]:
        """
        Collect Real-time Database & Router Snapshot at THIS_MOMENT (Page-Aware Context Filtering).
        """
        self.sync_db_cache()
        prompt_lower = user_prompt.lower()

        snapshot: Dict[str, Any] = {
            "router_map": self.build_router_map_text(),
            "available_equipment_count": self._memory_cache.get("available_equipment_count", 0),
            "total_equipment_count": self._memory_cache.get("total_equipment_count", 0),
            "today_scheduled_students": self._memory_cache.get("schedules_summary", []),
            "top_5_faceid_events": self._memory_cache.get("recent_logs", [])[:5],
            "top_5_sensor_incidents": self._memory_cache.get("incidents_summary", [])[:5],
            "labs_and_managers": self._memory_cache.get("labs_summary", []),
            "nodes_state": self._memory_cache.get("nodes_summary", []),
            "current_page": current_page,
            "snapshot_timestamp": time.strftime("%Y-%m-%d %H:%M:%S")
        }

        # Page-Aware Context Filtering (Item 3)
        page_clean = current_page.lower().strip("/")
        if "equipment" in page_clean:
            snapshot["focused_page_data"] = f"User is on EQUIPMENT page. Full equipment inventory summary: {json.dumps(self._memory_cache.get('equipment_summary', []), ensure_ascii=False)}"
        elif "users" in page_clean:
            snapshot["focused_page_data"] = f"User is on USERS page. User directory summary: {json.dumps(self._memory_cache.get('users_summary', []), ensure_ascii=False)}"
        elif "logs" in page_clean:
            snapshot["focused_page_data"] = f"User is on ACCESS LOGS page. Recent access logs: {json.dumps(self._memory_cache.get('recent_logs', []), ensure_ascii=False)}"
        elif "schedules" in page_clean:
            snapshot["focused_page_data"] = f"User is on SCHEDULES page. Today timetables: {json.dumps(self._memory_cache.get('schedules_summary', []), ensure_ascii=False)}"
        elif "system" in page_clean:
            snapshot["focused_page_data"] = f"User is on SYSTEM / HARDWARE page. Node hardware telemetries: {json.dumps(self._memory_cache.get('nodes_summary', []), ensure_ascii=False)}"
        else:
            snapshot["focused_page_data"] = f"User is currently on '{current_page}' page."

        # RAG Knowledge search fallback for technical queries (Item 2)
        doc_context = self._search_knowledge_docs(user_prompt)
        if doc_context:
            snapshot["knowledge_rag_docs"] = doc_context

        return snapshot

    def build_strict_system_prompt(self, snapshot_data: Dict[str, Any], user_prompt: str) -> str:
        """
        Construct strict context prompt according to exact 3-part layout requested.
        """
        router_map_str = snapshot_data.get("router_map", self.build_router_map_text())
        rag_doc_str = snapshot_data.get("knowledge_rag_docs", "")
        
        rbac_info = self.app_schema.get("roles_and_permissions", {})
        decision_flow = self.app_schema.get("decision_flow", {})
        guidance = self.app_schema.get("ai_capabilities_and_guidance", {})

        prompt = f"""[SYSTEM INSTRUCTION - REAL-TIME SNAPSHOT & SYSTEM ROADMAP]
You are the AI Assistant for the VGU Smart Lab Access Control & Equipment Management System. 
Below is the REAL-TIME SNAPSHOT & SYSTEM ROADMAP captured at THIS_MOMENT ({snapshot_data.get('snapshot_timestamp', '')}):

1. ROUTER MAP & NAVIGATION PATHS (Use these exact Markdown links [Title](/path) to guide users):
{router_map_str}

2. SYSTEM ROLE PERMISSIONS & DECISION RULES:
- RBAC Capabilities: Super Admin ({json.dumps(rbac_info.get('admin_roles', {}).get('super_admin', {}).get('capabilities', []), ensure_ascii=False)}), Lab Admin ({json.dumps(rbac_info.get('admin_roles', {}).get('lab_admin', {}).get('capabilities', []), ensure_ascii=False)})
- Biometric & PIN Decision Flow: {json.dumps(decision_flow.get('logic_rules', []), ensure_ascii=False)}
- Security Guardrails: {json.dumps(guidance.get('security_guardrails', []), ensure_ascii=False)}

3. CURRENT DATABASE STATE & ACTIVE VIEW:
- Active View Context: {snapshot_data.get('focused_page_data', '')}
- Total Available Equipment/Components: {snapshot_data.get('available_equipment_count', 0)} / {snapshot_data.get('total_equipment_count', 0)} available
- Today's Scheduled Classes & Students: {json.dumps(snapshot_data.get('today_scheduled_students', []), ensure_ascii=False)}

4. REAL-TIME LOGS & HARDWARE ALERTS:
- Top 5 Recent FaceID Check-in Events: {json.dumps(snapshot_data.get('top_5_faceid_events', []), ensure_ascii=False)}
- Top 5 Recent Sensor Telemetry & Security Alerts: {json.dumps(snapshot_data.get('top_5_sensor_incidents', []), ensure_ascii=False)}
- Hardware Nodes State: {json.dumps(snapshot_data.get('nodes_state', []), ensure_ascii=False)}
{f"- RAG Technical Docs Knowledge: {rag_doc_str}" if rag_doc_str else ""}

RESPONSE RULES:
- Always answer using the exact real-time snapshot data above.
- When referring to system pages or features, ALWAYS embed clickable Markdown links in the format [Title](/path) so users can click to navigate immediately.
- Enforce RBAC: Never advise a Lab Admin to execute Super Admin actions (creating labs, changing global AI thresholds).
- Be concise, clear, helpful, and highly professional.

[USER QUESTION]: "{user_prompt}"
"""
        return prompt

    def generate_response(
        self,
        user_prompt: str,
        current_page: str = "overview",
        history: Optional[List[Dict[str, str]]] = None,
        lab_id: Optional[str] = None,
        custom_table_data: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Send prompt and extracted real-time snapshot to Qwen 2.5 Coder local API endpoint.
        Hyperparameters tuned: temperature = 0.15, max_tokens = 700.
        """
        status_info = self.check_status()
        if status_info["status"] == "offline":
            return {
                "success": False,
                "response": (
                    "⚠️ **Unable to connect to Qwen 2.5 Coder AI Service!**\n\n"
                    "The local LLM service is not running at `" + self.api_base + "`."
                ),
                "offline": True
            }

        # Item 1: Dynamic Intent Detection for Auto-Navigation
        action, target_route = self.detect_navigation_intent(user_prompt)

        # Item 3: Page-Aware Real-time Snapshot
        snapshot_data = self.extract_realtime_snapshot(user_prompt=user_prompt, current_page=current_page)
        system_instructions = self.build_strict_system_prompt(snapshot_data=snapshot_data, user_prompt=user_prompt)

        messages = [
            {"role": "system", "content": system_instructions}
        ]

        if history:
            for item in history[-2:]: # Keep last 2 messages for fast processing
                role = item.get("role", "user")
                content = item.get("content", "")
                if role in ["user", "assistant"] and content:
                    messages.append({"role": role, "content": content})

        messages.append({"role": "user", "content": user_prompt})

        # Item 5: Max Tokens 700 & Low Temperature 0.15 Tuning
        payload = {
            "model": self.model_name,
            "messages": messages,
            "temperature": 0.15,
            "top_p": 0.9,
            "max_tokens": 700
        }

        try:
            req_url = f"{self.api_base}/chat/completions"
            data_bytes = json.dumps(payload).encode('utf-8')
            req = urllib.request.Request(req_url, data=data_bytes, headers={"Content-Type": "application/json"})
            
            if self.api_key:
                req.add_header("Authorization", f"Bearer {self.api_key}")

            with urllib.request.urlopen(req, timeout=120) as resp:
                if resp.status == 200:
                    resp_data = json.loads(resp.read().decode('utf-8'))
                    ai_reply = resp_data["choices"][0]["message"]["content"]
                    return {
                        "success": True,
                        "response": ai_reply,
                        "action": action,
                        "target_route": target_route,
                        "model": resp_data.get("model", self.model_name)
                    }
                else:
                    return {
                        "success": False,
                        "response": f"HTTP error {resp.status} from Qwen 2.5 Coder API."
                    }
        except Exception as e:
            logger.error(f"Error querying Qwen 2.5 Coder API: {e}")
            return {
                "success": False,
                "response": f"An error occurred while processing request with Qwen 2.5 Coder: {str(e)}"
            }
