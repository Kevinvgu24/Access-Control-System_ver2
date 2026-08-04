import os
import json
import time
import hashlib
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
        
        # Caches for ultra-fast zero-latency response
        self._status_cache: Optional[Dict[str, Any]] = None
        self._last_status_check: float = 0.0
        self._status_cache_ttl: float = 30.0  # Check Ollama status max once per 30s
        self._semantic_qa_cache: Dict[str, Dict[str, Any]] = {}  # Semantic Q&A cache
        
        # Pre-cache documentation text in RAM to eliminate disk I/O on chat prompts
        self._doc_cache: Dict[str, str] = self._preload_knowledge_docs()
        self.router_map_text: str = self.build_router_map_text()

        # Deep-Layer In-Memory Cache for Zero-Latency RAG
        self._memory_cache: Dict[str, Any] = {}
        self._last_cache_update: float = 0.0
        self._cache_ttl_seconds: float = 15.0  # Auto-refresh every 15s

        # Initialize cache snapshot
        self.sync_db_cache(force=True)

    def _preload_knowledge_docs(self) -> Dict[str, str]:
        """Pre-load workspace Markdown documentation into RAM once at startup."""
        docs = {}
        doc_files = ["MQTT_sensor/Sensor_Connection_Guide.md", "README_DEPLOY.md", "SECURITY_REPORT.md", "pipeline_architecture.md", "technical.md"]
        for doc_rel_path in doc_files:
            doc_full_path = os.path.join(project_root, doc_rel_path)
            if os.path.exists(doc_full_path):
                try:
                    with open(doc_full_path, "r", encoding="utf-8", errors="ignore") as f:
                        docs[doc_rel_path] = f.read()
                except Exception as e:
                    logger.debug(f"Error preloading doc {doc_rel_path}: {e}")
        return docs

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
        Check connection status to Qwen 2.5 Coder local API endpoint (cached for 30s).
        """
        now = time.time()
        if self._status_cache and (now - self._last_status_check) < self._status_cache_ttl:
            return self._status_cache

        models_url = f"{self.api_base}/models"
        try:
            req = urllib.request.Request(models_url)
            if self.api_key:
                req.add_header("Authorization", f"Bearer {self.api_key}")
            
            with urllib.request.urlopen(req, timeout=3) as resp:
                if resp.status == 200:
                    data = json.loads(resp.read().decode('utf-8'))
                    self._status_cache = {
                        "status": "online",
                        "model": self.model_name,
                        "api_base": self.api_base,
                        "available_models": [m.get("id") for m in data.get("data", [])] if "data" in data else []
                    }
                    self._last_status_check = now
                    return self._status_cache
        except Exception as e:
            logger.debug(f"Qwen API status check failed: {e}")
            
        self._status_cache = {
            "status": "offline",
            "model": self.model_name,
            "api_base": self.api_base,
            "error": "Cannot connect to Qwen 2.5 Coder LLM service. Ensure Ollama is running."
        }
        self._last_status_check = now
        return self._status_cache

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
        Synchronize full in-memory snapshot of ALL SQLite DB tables and columns safely.
        """
        now = time.time()
        if not force and (now - self._last_cache_update) < self._cache_ttl_seconds:
            return

        conn = None
        try:
            conn = self._get_db_connection()
            c = conn.cursor()

            # 1. Labs Snapshot
            labs_list, active_labs_cnt = [], 0
            try:
                c.execute("SELECT id, name, code, location, manager, status FROM labs")
                lab_rows = c.fetchall()
                labs_list = [f"Lab '{r['name']}' ({r['code']}): Mgr={r['manager'] or 'N/A'}, Status={r['status']}" for r in lab_rows]
                active_labs_cnt = sum(1 for r in lab_rows if r['status'] == 'active')
            except Exception as e:
                logger.debug(f"Labs sync notice: {e}")

            # 2. Nodes Snapshot
            nodes_list = []
            try:
                c.execute("SELECT id, name, code, location, status, onlineState FROM nodes")
                node_rows = c.fetchall()
                nodes_list = [f"Node '{r['name']}': Status={r['status']}({r['onlineState']})" for r in node_rows]
            except Exception as e:
                logger.debug(f"Nodes sync notice: {e}")

            # 3. Users Snapshot (Critical Fix)
            users_list = []
            try:
                c.execute("SELECT id, name, university_id, role, status FROM users")
                u_rows = c.fetchall()
                users_list = [
                    f"User '{r['name']}' (ID:{r['university_id'] or r['id']}, Role:{r['role']}, Status:{r['status']})"
                    for r in u_rows
                ]
            except Exception as e:
                logger.error(f"Users query error: {e}")

            # 4. Equipment Snapshot
            equipment_list, overdue_list, total_eq_count, avail_eq_count = [], [], 0, 0
            try:
                c.execute("SELECT name, serial_number as code, category, status, assigned_to as borrowedByName, location FROM equipment")
                eq_rows = c.fetchall()
                total_eq_count = len(eq_rows)
                for r in eq_rows:
                    status_str = f"Item '{r['name']}' ({r['status']})"
                    if r['borrowedByName']:
                        status_str += f" assigned to {r['borrowedByName']}"
                    equipment_list.append(status_str)
                    if str(r['status']).lower() in ['available', 'khả dụng', 'sẵn sàng']:
                        avail_eq_count += 1
                    if str(r['status']).lower() in ['overdue', 'quá hạn']:
                        overdue_list.append(f"'{r['name']}' (Assigned to {r['borrowedByName']})")
            except Exception as e:
                logger.debug(f"Equipment sync notice: {e}")

            # 5. Access Events Snapshot (Recent 5 Logs)
            logs_list = []
            try:
                c.execute("SELECT displayName as userName, method as accessMethod, result as status, occurredAt as timestamp FROM access_events ORDER BY id DESC LIMIT 5")
                log_rows = c.fetchall()
                logs_list = [f"Check-in '{r['userName']}': Method={r['accessMethod']}, Result={r['status']} at {r['timestamp']}" for r in log_rows]
            except Exception as e:
                logger.debug(f"Access events sync notice: {e}")

            # 6. Schedules Snapshot
            schedules_list = []
            try:
                c.execute("SELECT student_name, day_of_week, experiment, date FROM lab_schedules LIMIT 8")
                sch_rows = c.fetchall()
                schedules_list = [f"Schedule '{r['student_name']}': Exp={r['experiment']}, Day={r['day_of_week']} ({r['date']})" for r in sch_rows]
            except Exception:
                try:
                    c.execute("SELECT title, room, instructor, dayOfWeek FROM schedules LIMIT 8")
                    sch_rows = c.fetchall()
                    schedules_list = [f"Schedule '{r['title']}': Room={r['room']}, Teacher={r['instructor']}" for r in sch_rows]
                except Exception as e:
                    logger.debug(f"Schedules sync notice: {e}")

            # 7. Security Incidents Snapshot
            incidents_list = []
            try:
                c.execute("SELECT type, severity, status, summary, createdAt FROM incidents ORDER BY id DESC LIMIT 5")
                inc_rows = c.fetchall()
                incidents_list = [f"Incident '{r['type']}' [{r['severity']}]: Status={r['status']} ({r['summary']})" for r in inc_rows]
            except Exception as e:
                logger.debug(f"Incidents sync notice: {e}")

            self._memory_cache = {
                "labs_summary": labs_list,
                "total_labs": len(labs_list),
                "active_labs_count": active_labs_cnt,
                "nodes_summary": nodes_list,
                "users_summary": users_list,
                "total_users": len(users_list),
                "equipment_summary": equipment_list[:15],
                "available_equipment_count": avail_eq_count,
                "total_equipment_count": total_eq_count,
                "overdue_items": overdue_list,
                "recent_logs": logs_list[:5],
                "schedules_summary": schedules_list,
                "incidents_summary": incidents_list[:5],
                "synced_at": time.strftime("%H:%M:%S")
            }
            self._last_cache_update = now
        except Exception as e:
            logger.error(f"Error syncing DB in-memory cache: {e}")
        finally:
            if conn:
                conn.close()

    def _search_knowledge_docs(self, user_prompt: str) -> str:
        """
        Lightweight fast in-memory RAG search across pre-loaded Markdown files.
        Only runs if technical doc keywords are present in prompt.
        """
        prompt_lower = user_prompt.lower()
        tech_keywords = ["mqtt", "sensor", "cảm biến", "deploy", "docker", "bảo mật", "security", "sơ đồ", "cấu hình", "hailo", "rpi5", "architecture", "hardware"]
        
        if not any(kw in prompt_lower for kw in tech_keywords):
            return ""

        relevant_snippets = []
        for doc_rel_path, content in self._doc_cache.items():
            lines = content.splitlines()
            matched_lines = [l.strip() for l in lines if any(k in l.lower() for k in prompt_lower.split() if len(k) > 3)]
            if matched_lines:
                relevant_snippets.append(f"--- Doc '{doc_rel_path}' ---\n" + "\n".join(matched_lines[:3]))
                    
        return "\n".join(relevant_snippets[:2]) if relevant_snippets else ""

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
            lines.append(f"- [{title}]({path}): {desc}")
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

    def query_students_by_date(self, user_prompt: str) -> Optional[str]:
        """
        Query students scheduled for a specific date from SQLite lab_schedules.
        Recognizes "hôm nay", "ngày mai", "hôm qua", or specific dates like "YYYY-MM-DD", "DD/MM/YYYY".
        """
        prompt_lower = user_prompt.lower()
        target_date_str = None
        
        today = time.strftime("%Y-%m-%d")
        if "hôm nay" in prompt_lower or "today" in prompt_lower:
            target_date_str = today
        elif "hôm qua" in prompt_lower or "yesterday" in prompt_lower:
            import datetime
            target_date_str = (datetime.date.today() - datetime.timedelta(days=1)).strftime("%Y-%m-%d")
        elif "ngày mai" in prompt_lower or "tomorrow" in prompt_lower:
            import datetime
            target_date_str = (datetime.date.today() + datetime.timedelta(days=1)).strftime("%Y-%m-%d")
        else:
            import re
            m = re.search(r'(\d{4}-\d{2}-\d{2})|(\d{1,2}/\d{1,2}/\d{4})', prompt_lower)
            if m:
                target_date_str = m.group(0)

        if target_date_str or any(kw in prompt_lower for kw in ["lịch học", "sinh viên", "đi làm lab", "trực lab", "danh sách sinh viên", "ai đi học", "ai có lịch"]):
            conn = None
            try:
                conn = self._get_db_connection()
                c = conn.cursor()
                if target_date_str:
                    c.execute("SELECT student_id, student_name, group_nr, day_of_week, experiment, date FROM lab_schedules WHERE date LIKE ?", (f"%{target_date_str}%",))
                else:
                    c.execute("SELECT student_id, student_name, group_nr, day_of_week, experiment, date FROM lab_schedules LIMIT 15")
                rows = c.fetchall()
                if rows:
                    lines = [f"- {r['student_name']} (MSSV: {r['student_id'] or 'N/A'}, Nhóm: {r['group_nr'] or 'N/A'}, Bài TN: {r['experiment'] or 'N/A'}, Ngày: {r['date'] or r['day_of_week']})" for r in rows]
                    return f"Scheduled Students ({target_date_str or 'All Records'}, Total {len(rows)}):\n" + "\n".join(lines)
            except Exception as e:
                logger.debug(f"Error querying schedule by date: {e}")
            finally:
                if conn:
                    conn.close()
        return None

    def extract_realtime_snapshot(self, user_prompt: str = "", current_page: str = "overview") -> Dict[str, Any]:
        """
        Collect Real-time Database & Router Snapshot at THIS_MOMENT (Page-Aware Context Filtering).
        """
        self.sync_db_cache()

        snapshot: Dict[str, Any] = {
            "router_map": self.router_map_text,
            "available_equipment_count": self._memory_cache.get("available_equipment_count", 0),
            "total_equipment_count": self._memory_cache.get("total_equipment_count", 0),
            "today_scheduled_students": self._memory_cache.get("schedules_summary", []),
            "top_5_faceid_events": self._memory_cache.get("recent_logs", [])[:5],
            "top_5_sensor_incidents": self._memory_cache.get("incidents_summary", [])[:3],
            "nodes_state": self._memory_cache.get("nodes_summary", []),
            "current_page": current_page,
            "snapshot_timestamp": time.strftime("%H:%M:%S")
        }

        # Page-Aware Context Filtering (Item 3)
        page_clean = current_page.lower().strip("/")
        if "equipment" in page_clean:
            snapshot["focused_page_data"] = f"EQUIPMENT View: {json.dumps(self._memory_cache.get('equipment_summary', [])[:8], ensure_ascii=False)}"
        elif "users" in page_clean:
            snapshot["focused_page_data"] = f"USERS View: {json.dumps(self._memory_cache.get('users_summary', []), ensure_ascii=False)}"
        elif "logs" in page_clean:
            snapshot["focused_page_data"] = f"LOGS View: {json.dumps(self._memory_cache.get('recent_logs', []), ensure_ascii=False)}"
        elif "schedules" in page_clean:
            snapshot["focused_page_data"] = f"SCHEDULES View: {json.dumps(self._memory_cache.get('schedules_summary', []), ensure_ascii=False)}"
        elif "system" in page_clean:
            snapshot["focused_page_data"] = f"SYSTEM View: {json.dumps(self._memory_cache.get('nodes_summary', []), ensure_ascii=False)}"
        else:
            snapshot["focused_page_data"] = f"Active page: '{current_page}'"

        # Check for specific date/schedule student queries
        date_students = self.query_students_by_date(user_prompt)
        if date_students:
            snapshot["focused_page_data"] += f" | {date_students}"

        # RAG Knowledge search fallback for technical queries
        doc_context = self._search_knowledge_docs(user_prompt)
        if doc_context:
            snapshot["knowledge_rag_docs"] = doc_context

        return snapshot

    def build_strict_system_prompt(self, snapshot_data: Dict[str, Any], user_prompt: str) -> str:
        """
        Construct strict context prompt according to exact 3-part layout requested.
        """
        router_map_str = snapshot_data.get("router_map", self.router_map_text)
        rag_doc_str = snapshot_data.get("knowledge_rag_docs", "")

        prompt = f"""[SYSTEM INSTRUCTION - REAL-TIME SNAPSHOT & ROADMAP]
You are the AI Assistant for VGU Smart Lab Access Control System.
REAL-TIME SNAPSHOT ({snapshot_data.get('snapshot_timestamp', '')}):

1. ROUTER MAP (Embed clickable Markdown links [Title](/path) to direct users):
{router_map_str}

2. CURRENT STATE ({snapshot_data.get('focused_page_data', '')}):
- Equipment Available: {snapshot_data.get('available_equipment_count', 0)} / {snapshot_data.get('total_equipment_count', 0)}
- Today's Classes: {json.dumps(snapshot_data.get('today_scheduled_students', []), ensure_ascii=False)}

3. LOGS & ALERTS:
- Recent FaceID Logs: {json.dumps(snapshot_data.get('top_5_faceid_events', []), ensure_ascii=False)}
- Node Hardware States: {json.dumps(snapshot_data.get('nodes_state', []), ensure_ascii=False)}
{f"- Tech Docs: {rag_doc_str}" if rag_doc_str else ""}

RULES:
- Answer using exact real-time snapshot data above.
- ALWAYS embed clickable Markdown links [Title](/path) when introducing pages or navigation.
- Be concise, direct, helpful, and fast.

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

        # Check Semantic Cache for instant response
        cache_key = self.get_semantic_cache_key(user_prompt, current_page)
        now = time.time()
        if cache_key in self._semantic_qa_cache:
            cached_entry = self._semantic_qa_cache[cache_key]
            if (now - cached_entry["time"]) < 300: # 5 min TTL
                logger.info(f"⚡ Instant Semantic Cache HIT for prompt: '{user_prompt}'")
                return {
                    "success": True,
                    "response": cached_entry["response"],
                    "action": cached_entry["action"],
                    "target_route": cached_entry["target_route"],
                    "cached": True,
                    "model": f"{self.model_name} (Cached)"
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
                    
                    # Store in Semantic Cache
                    self._semantic_qa_cache[cache_key] = {
                        "response": ai_reply,
                        "action": action,
                        "target_route": target_route,
                        "time": now
                    }

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

    def get_semantic_cache_key(self, prompt: str, page: str) -> str:
        clean_p = prompt.strip().lower()
        return hashlib.md5(f"{page}:{clean_p}".encode('utf-8')).hexdigest()

    def generate_response_stream(
        self,
        user_prompt: str,
        current_page: str = "overview",
        history: Optional[List[Dict[str, str]]] = None,
        lab_id: Optional[str] = None
    ):
        """
        Stream SSE response tokens with sub-100ms Time-To-First-Token (TTFT).
        Yields dicts with 'token', 'action', 'target_route', 'done'.
        """
        cache_key = self.get_semantic_cache_key(user_prompt, current_page)
        now = time.time()
        if cache_key in self._semantic_qa_cache:
            cached_entry = self._semantic_qa_cache[cache_key]
            if (now - cached_entry["time"]) < 300: # 5 min TTL
                logger.info(f"⚡ Instant Semantic Cache HIT (Stream) for prompt: '{user_prompt}'")
                yield {
                    "token": cached_entry["response"],
                    "action": cached_entry["action"],
                    "target_route": cached_entry["target_route"],
                    "cached": True,
                    "done": True
                }
                return

        status_info = self.check_status()
        if status_info["status"] == "offline":
            yield {
                "token": "⚠️ **Unable to connect to Qwen 2.5 Coder AI Service!** Ensure Ollama is running.",
                "action": None,
                "target_route": None,
                "done": True
            }
            return

        action, target_route = self.detect_navigation_intent(user_prompt)
        snapshot_data = self.extract_realtime_snapshot(user_prompt=user_prompt, current_page=current_page)
        system_instructions = self.build_strict_system_prompt(snapshot_data=snapshot_data, user_prompt=user_prompt)

        messages = [
            {"role": "system", "content": system_instructions}
        ]

        if history:
            for item in history[-2:]:
                role = item.get("role", "user")
                content = item.get("content", "")
                if role in ["user", "assistant"] and content:
                    messages.append({"role": role, "content": content})

        messages.append({"role": "user", "content": user_prompt})

        payload = {
            "model": self.model_name,
            "messages": messages,
            "temperature": 0.15,
            "top_p": 0.9,
            "max_tokens": 700,
            "stream": True
        }

        full_accumulated_text = ""
        try:
            req_url = f"{self.api_base}/chat/completions"
            data_bytes = json.dumps(payload).encode('utf-8')
            req = urllib.request.Request(req_url, data=data_bytes, headers={"Content-Type": "application/json"})
            if self.api_key:
                req.add_header("Authorization", f"Bearer {self.api_key}")

            with urllib.request.urlopen(req, timeout=120) as resp:
                for chunk in resp:
                    chunk_str = chunk.decode('utf-8').strip()
                    if not chunk_str or chunk_str == "data: [DONE]":
                        continue
                    if chunk_str.startswith("data: "):
                        chunk_str = chunk_str[6:]
                    try:
                        data_obj = json.loads(chunk_str)
                        choices = data_obj.get("choices", [])
                        if choices:
                            delta = choices[0].get("delta", {})
                            content_piece = delta.get("content", "")
                            if content_piece:
                                full_accumulated_text += content_piece
                                yield {
                                    "token": content_piece,
                                    "action": action,
                                    "target_route": target_route,
                                    "done": False
                                }
                    except Exception:
                        pass

            if full_accumulated_text:
                self._semantic_qa_cache[cache_key] = {
                    "response": full_accumulated_text,
                    "action": action,
                    "target_route": target_route,
                    "time": now
                }
            
            yield {
                "token": "",
                "action": action,
                "target_route": target_route,
                "done": True
            }
        except Exception as e:
            logger.error(f"Error in stream generation: {e}")
            yield {
                "token": f"An error occurred: {str(e)}",
                "action": action,
                "target_route": target_route,
                "done": True
            }
