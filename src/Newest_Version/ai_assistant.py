import os
import json
import time
import sqlite3
import urllib.request
import urllib.error
from typing import Dict, Any, List, Optional
from logger import get_logger

logger = get_logger("ai_assistant")

class QwenAIAssistant:
    def __init__(self, db_path: str = "database/smart_door.db"):
        self.db_path = db_path
        if not os.path.exists(self.db_path) and os.path.exists("smart_door.db"):
            self.db_path = "smart_door.db"
            
        self.api_base = os.getenv("QWEN_API_BASE", "http://localhost:11434/v1").rstrip("/")
        self.model_name = os.getenv("QWEN_MODEL_NAME", "qwen2.5-coder:1.5b")
        self.api_key = os.getenv("QWEN_API_KEY", "ollama")

        # Deep-Layer In-Memory Cache for Zero-Latency RAG
        self._memory_cache: Dict[str, Any] = {}
        self._last_cache_update: float = 0.0
        self._cache_ttl_seconds: float = 15.0  # Auto-refresh every 15s

        # Pre-load system static knowledge base into memory
        self._system_knowledge = {
            "app_name": "Access Control System v2",
            "pages": {
                "overview": "System summary, traffic analytics, real-time live feed, connection alerts.",
                "users": "User management, add student/staff/admin, role assignment, pin/status toggles.",
                "enrollment": "Biometric registration, Face ID 512-dim ArcFace embedding capture, PIN setup.",
                "equipment": "Lab inventory, equipment borrow/return workflow, overdue tracking.",
                "schedules": "Class/lab timetables, automated door unlocking schedules, Excel .xlsx import.",
                "logs": "Audit logs, RFID/Face/PIN entry records, security violations, CSV export.",
                "system": "Door nodes configuration, face threshold, relay time, MQTT broker settings."
            }
        }

        # Initialize cache snapshot
        self.sync_db_cache(force=True)

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
        Synchronize in-memory snapshot of SQLite DB tables to minimize prompt token overhead.
        """
        now = time.time()
        if not force and (now - self._last_cache_update) < self._cache_ttl_seconds:
            return

        try:
            conn = self._get_db_connection()
            c = conn.cursor()

            # 1. Users Snapshot
            c.execute("SELECT id, name, role, status FROM users LIMIT 20")
            u_rows = c.fetchall()
            users_list = [f"{r['name']} ({r['role']}/{r['status']})" for r in u_rows]

            # 2. Equipment Snapshot
            c.execute("SELECT name, code, status, borrowedByName, dueDate FROM equipment")
            eq_rows = c.fetchall()
            equipment_list = []
            overdue_list = []
            for r in eq_rows:
                status_str = f"{r['name']} [{r['status']}]"
                if r['borrowedByName']:
                    status_str += f" (Borrower: {r['borrowedByName']})"
                equipment_list.append(status_str)
                if r['status'] in ['overdue', 'Overdue']:
                    overdue_list.append(f"{r['name']} (Borrowed by {r['borrowedByName']})")

            # 3. Access Events Snapshot (Recent 5)
            c.execute("SELECT userName, accessMethod, status, timestamp FROM access_events ORDER BY id DESC LIMIT 5")
            log_rows = c.fetchall()
            logs_list = [f"{r['userName']} ({r['accessMethod']}/{r['status']} at {r['timestamp']})" for r in log_rows]

            # 4. Schedules Snapshot
            c.execute("SELECT title, room, instructor, dayOfWeek, startTime, endTime FROM schedules LIMIT 10")
            sch_rows = c.fetchall()
            schedules_list = [f"{r['title']} ({r['room']} - {r['instructor']} - {r['dayOfWeek']} {r['startTime']}-{r['endTime']})" for r in sch_rows]

            conn.close()

            self._memory_cache = {
                "users_summary": users_list,
                "total_users": len(users_list),
                "equipment_summary": equipment_list,
                "overdue_items": overdue_list,
                "recent_logs": logs_list,
                "schedules_summary": schedules_list,
                "synced_at": time.strftime("%H:%M:%S")
            }
            self._last_cache_update = now
        except Exception as e:
            logger.error(f"Error syncing DB in-memory cache: {e}")

    def extract_table_context(self, lab_id: Optional[str] = None, page: str = "overview") -> str:
        """
        Extract pre-cached, ultra-compact micro JSON summary (Zero prefill latency).
        """
        self.sync_db_cache()

        if page in ["users", "enrollment"]:
            data = {"users": self._memory_cache.get("users_summary", []), "page": page}
        elif page == "equipment":
            data = {
                "equipment": self._memory_cache.get("equipment_summary", []),
                "overdue_items": self._memory_cache.get("overdue_items", [])
            }
        elif page == "logs":
            data = {"recent_logs": self._memory_cache.get("recent_logs", [])}
        elif page == "schedules":
            data = {"schedules": self._memory_cache.get("schedules_summary", [])}
        else:
            data = {
                "active_users": self._memory_cache.get("total_users", 0),
                "overdue": self._memory_cache.get("overdue_items", []),
                "latest_access": self._memory_cache.get("recent_logs", [])[:3]
            }

        return json.dumps(data, ensure_ascii=False)

    def get_system_instructions(self, current_page: str = "overview") -> str:
        """
        Ultra-concise system prompt for instant TTFT execution.
        """
        guide = self._system_knowledge["pages"].get(current_page, self._system_knowledge["pages"]["overview"])

        prompt = f"""You are **Qwen 2.5 Coder AI Assistant** for the Access Control System v2.

### Rules:
1. **Factual**: Answer using the cached DB JSON provided in user prompt.
2. **Missing Data**: If requested info is not in context, state: *"This data is currently not available in the system"*.
3. **Format**: Respond concisely in **English**.

### Page ({current_page.upper()}):
{guide}
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
        Send ultra-compact context to local Qwen 2.5 Coder with instant response speed.
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

        table_context = custom_table_data or self.extract_table_context(lab_id=lab_id, page=current_page)
        system_instructions = self.get_system_instructions(current_page=current_page)

        messages = [
            {"role": "system", "content": system_instructions}
        ]

        if history:
            for item in history[-2:]: # Keep last 2 messages for ultra-fast processing
                role = item.get("role", "user")
                content = item.get("content", "")
                if role in ["user", "assistant"] and content:
                    messages.append({"role": role, "content": content})

        full_user_content = f"DB_CACHE_JSON: {table_context}\n\nUser Question: {user_prompt}"
        messages.append({"role": "user", "content": full_user_content})

        payload = {
            "model": self.model_name,
            "messages": messages,
            "temperature": 0.0,
            "max_tokens": 300
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
