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

        # Comprehensive Database Schema Knowledge for AI
        self._system_knowledge = {
            "app_name": "Access Control System v2",
            "db_schema": {
                "labs": ["id", "name", "code", "location", "manager", "status", "activationCode"],
                "nodes": ["id", "clusterId", "labId", "name", "code", "deviceId", "location", "status", "onlineState"],
                "users": ["id", "name", "university_id", "email", "role", "status", "faceStatus", "pinStatus"],
                "equipment": ["id", "name", "code", "category", "status", "borrowedByName", "borrowerId", "borrowDate", "dueDate", "location"],
                "schedules": ["id", "title", "room", "instructor", "dayOfWeek", "startTime", "endTime", "status"],
                "access_events": ["id", "userName", "universityId", "accessMethod", "status", "isAuthorized", "confidence", "timestamp"],
                "incidents": ["id", "type", "severity", "status", "summary", "createdAt"]
            },
            "pages": {
                "overview": "System summary, active labs count, managers, traffic analytics, real-time live feed, connection alerts.",
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
                f"Lab: '{r['name']}' | Code: {r['code']} | Manager: {r['manager'] or 'N/A'} | Location: {r['location'] or 'N/A'} | Status: {r['status']}"
                for r in lab_rows
            ]
            active_labs_cnt = sum(1 for r in lab_rows if r['status'] == 'active')

            # 2. Nodes Snapshot (Door Hardware Devices)
            c.execute("SELECT id, name, code, deviceId, location, status, onlineState FROM nodes")
            node_rows = c.fetchall()
            nodes_list = [
                f"Node: '{r['name']}' | Code: {r['code']} | Location: {r['location']} | Status: {r['status']} ({r['onlineState']})"
                for r in node_rows
            ]

            # 3. Users Snapshot (with University ID, Email, Role, Status, Face/PIN Status)
            c.execute("SELECT id, name, university_id, email, role, status, faceStatus, pinStatus FROM users LIMIT 30")
            u_rows = c.fetchall()
            users_list = [
                f"User: '{r['name']}' | ID: {r['university_id'] or r['id']} | Email: {r['email'] or 'N/A'} | Role: {r['role']} | Status: {r['status']} | Face: {r['faceStatus']} | PIN: {r['pinStatus']}"
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
                status_str = f"Item: '{r['name']}' [Code: {r['code'] or 'N/A'}, Lab/Loc: {r['location'] or 'Main Lab'}, Category: {r['category'] or 'Module'}, Status: {r['status']}]"
                if r['borrowedByName']:
                    status_str += f" (Borrowed by: {r['borrowedByName']} [ID: {r['borrowerId'] or 'N/A'}], Due: {r['dueDate'] or 'N/A'})"
                equipment_list.append(status_str)
                if r['status'] in ['overdue', 'Overdue']:
                    overdue_list.append(f"'{r['name']}' in {r['location'] or 'Main Lab'} (Borrowed by {r['borrowedByName']}, Due: {r['dueDate']})")


            # 5. Access Events Snapshot (Recent 10 Logs)
            c.execute("SELECT userName, accessMethod, status, isAuthorized, timestamp FROM access_events ORDER BY id DESC LIMIT 10")
            log_rows = c.fetchall()
            logs_list = [
                f"Log: '{r['userName']}' | Method: {r['accessMethod']} | Status: {r['status']} | Authorized: {r['isAuthorized']} | Time: {r['timestamp']}"
                for r in log_rows
            ]

            # 6. Schedules & Timetables Snapshot
            c.execute("SELECT title, room, instructor, dayOfWeek, startTime, endTime FROM schedules LIMIT 10")
            sch_rows = c.fetchall()
            schedules_list = [
                f"Schedule: '{r['title']}' | Room: {r['room']} | Instructor: {r['instructor']} | Day: {r['dayOfWeek']} {r['startTime']}-{r['endTime']}"
                for r in sch_rows
            ]

            # 7. Security Incidents Snapshot
            c.execute("SELECT type, severity, status, summary, createdAt FROM incidents ORDER BY id DESC LIMIT 5")
            inc_rows = c.fetchall()
            incidents_list = [
                f"Incident: '{r['type']}' [{r['severity']}] | Status: {r['status']} | Summary: {r['summary']} | Time: {r['createdAt']}"
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
                "overdue_items": overdue_list,
                "recent_logs": logs_list,
                "schedules_summary": schedules_list,
                "incidents_summary": incidents_list,
                "synced_at": time.strftime("%H:%M:%S")
            }
            self._last_cache_update = now
        except Exception as e:
            logger.error(f"Error syncing DB in-memory cache: {e}")

    def extract_table_context(self, lab_id: Optional[str] = None, page: str = "overview", user_prompt: str = "") -> str:
        """
        Smart Context Extractor: Dynamically searches ALL SQLite tables and columns for exact user prompts.
        """
        self.sync_db_cache()
        prompt_lower = user_prompt.lower()

        data: Dict[str, Any] = {}

        # 1. Intent: Labs, Rooms, Managers, Active Status, Nodes
        if any(w in prompt_lower for w in ["lab", "phòng", "room", "active", "hoạt động", "bao nhiêu", "how many", "count", "trạm", "node", "quản lý", "manager", "phụ trách"]):
            try:
                conn = self._get_db_connection()
                c = conn.cursor()
                c.execute("SELECT id, name, code, location, manager, status FROM labs")
                lab_rows = c.fetchall()
                data["labs_list"] = [
                    f"Name: {r['name']} | Code: {r['code']} | Manager: {r['manager'] or 'N/A'} | Location: {r['location'] or 'N/A'} | Status: {r['status']}"
                    for r in lab_rows
                ]
                data["total_labs_count"] = len(lab_rows)
                data["active_labs_count"] = sum(1 for r in lab_rows if r['status'] == 'active')

                c.execute("SELECT id, name, code, location, status, onlineState FROM nodes")
                node_rows = c.fetchall()
                data["nodes_list"] = [f"Node: {r['name']} ({r['location']}) - Status: {r['status']}" for r in node_rows]
                conn.close()
            except Exception as e:
                logger.error(f"Error querying labs & managers: {e}")

        # 2. Intent: Logins, Door Access Events, Who Entered Today
        if any(w in prompt_lower for w in ["who", "login", "log", "access", "entry", "vào", "ra", "đăng nhập", "quẹt", "hôm nay", "today", "ai", "tới", "đến", "ghé"]):
            try:
                conn = self._get_db_connection()
                c = conn.cursor()
                c.execute("SELECT userName, accessMethod, status, isAuthorized, confidence, timestamp FROM access_events ORDER BY id DESC LIMIT 15")
                rows = c.fetchall()
                data["today_access_events_log"] = [
                    f"User: {r['userName']} | Method: {r['accessMethod']} | Authorized: {r['isAuthorized']} | Confidence: {r['confidence']}% | Time: {r['timestamp']}"
                    for r in rows
                ]
                data["total_entries_count"] = len(rows)
                conn.close()
            except Exception as e:
                logger.error(f"Error querying access events log: {e}")

        # 3. Intent: Equipment, Inventory, Borrowing, Overdue in Labs
        if any(w in prompt_lower for w in ["equipment", "item", "borrow", "overdue", "thiết bị", "mượn", "quá hạn", "đồ", "món", "có gì", "có những gì", "dụng cụ", "vật dụng"]):
            try:
                conn = self._get_db_connection()
                c = conn.cursor()
                try:
                    c.execute("SELECT name, code, category, status, borrowedByName, borrowerId, borrowDate, dueDate, location FROM equipment LIMIT 30")
                    rows = c.fetchall()
                except Exception:
                    c.execute("SELECT name, serialNumber as code, category, status, borrowerName as borrowedByName, borrowerId, borrowDate, returnDate as dueDate, location FROM lab_equipment LIMIT 30")
                    rows = c.fetchall()

                data["equipment_inventory_list"] = [
                    f"Item: '{r['name']}' | Code: {r['code'] or 'N/A'} | Category: {r['category'] or 'Module'} | Lab/Location: {r['location'] or 'Main Lab'} | Status: {r['status']} | Borrower: {r['borrowedByName'] or 'None'} | Due: {r['dueDate'] or 'N/A'}"
                    for r in rows
                ]
                conn.close()
            except Exception as e:
                logger.error(f"Error querying equipment: {e}")


        # 4. Intent: Users, Roles, Student/Staff, Registration Status
        if any(w in prompt_lower for w in ["user", "student", "staff", "admin", "người dùng", "sinh viên", "giảng viên", "role", "danh sách"]):
            try:
                conn = self._get_db_connection()
                c = conn.cursor()
                c.execute("SELECT name, university_id, email, role, status, faceStatus, pinStatus FROM users LIMIT 30")
                rows = c.fetchall()
                data["users_list"] = [
                    f"Name: {r['name']} | UniID: {r['university_id'] or 'N/A'} | Role: {r['role']} | Status: {r['status']} | FaceID: {r['faceStatus']} | PIN: {r['pinStatus']}"
                    for r in rows
                ]
                conn.close()
            except Exception as e:
                logger.error(f"Error querying users: {e}")

        # Default fallback to page cache
        if page in ["users", "enrollment"] and "users_list" not in data:
            data["users"] = self._memory_cache.get("users_summary", [])
        elif page == "equipment" and "equipment_inventory_list" not in data:
            data["equipment"] = self._memory_cache.get("equipment_summary", [])
            data["overdue_items"] = self._memory_cache.get("overdue_items", [])
        elif page == "logs" and "today_access_events_log" not in data:
            data["recent_logs"] = self._memory_cache.get("recent_logs", [])
        elif page == "schedules":
            data["schedules"] = self._memory_cache.get("schedules_summary", [])
        elif not data:
            data = {
                "total_labs": self._memory_cache.get("total_labs", 0),
                "active_labs": self._memory_cache.get("active_labs_count", 0),
                "labs": self._memory_cache.get("labs_summary", []),
                "nodes": self._memory_cache.get("nodes_summary", []),
                "total_users": self._memory_cache.get("total_users", 0),
                "overdue_equipment": self._memory_cache.get("overdue_items", []),
                "latest_access_logs": self._memory_cache.get("recent_logs", [])[:3]
            }

        return json.dumps(data, ensure_ascii=False)

    def get_system_instructions(self, current_page: str = "overview") -> str:
        """
        Natural & friendly system prompt with strict database grounding and interactive route links.
        """
        guide = self._system_knowledge["pages"].get(current_page, self._system_knowledge["pages"]["overview"])

        prompt = f"""You are **Qwen 2.5 Coder AI Assistant** for the Access Control System v2.

### Persona & Style:
- **Friendly & Natural**: Answer in a warm, helpful, and natural conversational tone. Avoid overly robotic or rigid templates.
- **Strictly Grounded**: Always base your answers strictly on the facts present in the provided `DATABASE_SNAPSHOT_JSON`.
- **Interactive Links**: Naturally embed clickable page links when guiding users or mentioning system sections:
  - User Management: [Users Page](/users)
  - Biometric & PIN Setup: [Enrollment Page](/enrollment)
  - Equipment & Inventory: [Equipment Page](/equipment)
  - Schedules & Timetables: [Schedules Page](/schedules)
  - Access Audit Logs: [Access Logs](/logs)
  - Door Hardware & Nodes: [System Settings](/system)
  - Main Dashboard: [Overview Page](/overview)
- **Language**: Respond in clear, natural **English** using clean Markdown.

### Current Page ({current_page.upper()}):
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
        Send prompt and extracted table context to Qwen 2.5 Coder local API endpoint with natural 0.2 temperature.
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

        table_context = custom_table_data or self.extract_table_context(lab_id=lab_id, page=current_page, user_prompt=user_prompt)
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

        full_user_content = f"FULL_DATABASE_SNAPSHOT_JSON: {table_context}\n\nUser Question: {user_prompt}"
        messages.append({"role": "user", "content": full_user_content})

        payload = {
            "model": self.model_name,
            "messages": messages,
            "temperature": 0.2,
            "top_p": 0.9,
            "max_tokens": 450
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
