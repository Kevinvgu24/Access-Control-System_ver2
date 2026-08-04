import os
import json
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
            "error": "Cannot connect to Qwen 2.5 Coder LLM service. Ensure Ollama/vLLM is running on port 11434."
        }

    def _get_db_connection(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def extract_table_context(self, lab_id: Optional[str] = None, page: str = "overview") -> str:
        """
        Extract concise, page-focused table data from SQLite DB formatted as Markdown for high-speed CPU inference.
        """
        context_parts = []
        try:
            conn = self._get_db_connection()
            c = conn.cursor()

            # 1. Users Table (Targeted for users & enrollment pages)
            if page in ["users", "enrollment"]:
                query = "SELECT id, name, university_id, email, role, status FROM users LIMIT 15"
                c.execute(query)
                rows = c.fetchall()
                if rows:
                    user_lines = ["### Users Table:"]
                    user_lines.append("| ID | Name | Staff/Student ID | Email | Role | Status |")
                    user_lines.append("|---|---|---|---|---|---|")
                    for r in rows:
                        user_lines.append(f"| {r['id']} | {r['name'] or ''} | {r['university_id'] or ''} | {r['email'] or ''} | {r['role'] or ''} | {r['status'] or ''} |")
                    context_parts.append("\n".join(user_lines))

            # 2. Equipment Table (Targeted for equipment page)
            elif page == "equipment":
                query = "SELECT id, name, code, category, status, borrowedByName, dueDate FROM equipment"
                if lab_id:
                    c.execute(query + " WHERE labId = ? LIMIT 15", (lab_id,))
                else:
                    c.execute(query + " LIMIT 15")
                rows = c.fetchall()
                if rows:
                    eq_lines = ["### Equipment Table:"]
                    eq_lines.append("| ID | Name | Code | Category | Status | Borrower | Due Date |")
                    eq_lines.append("|---|---|---|---|---|---|---|")
                    for r in rows:
                        eq_lines.append(f"| {r['id']} | {r['name'] or ''} | {r['code'] or ''} | {r['category'] or ''} | {r['status'] or ''} | {r['borrowedByName'] or 'N/A'} | {r['dueDate'] or 'N/A'} |")
                    context_parts.append("\n".join(eq_lines))

            # 3. Access Events / Logs Table (Targeted for logs page)
            elif page == "logs":
                query = "SELECT id, userName, accessMethod, status, isAuthorized, timestamp FROM access_events ORDER BY id DESC LIMIT 15"
                c.execute(query)
                rows = c.fetchall()
                if rows:
                    log_lines = ["### Access Logs Table:"]
                    log_lines.append("| ID | User | Method | Status | Authorized | Timestamp |")
                    log_lines.append("|---|---|---|---|---|---|")
                    for r in rows:
                        auth_str = "Authorized" if r['isAuthorized'] else "Unauthorized"
                        log_lines.append(f"| {r['id']} | {r['userName'] or 'Guest'} | {r['accessMethod'] or 'N/A'} | {r['status'] or ''} | {auth_str} | {r['timestamp'] or ''} |")
                    context_parts.append("\n".join(log_lines))

            # 4. Schedules Table (Targeted for schedules page)
            elif page == "schedules":
                query = "SELECT id, title, room, instructor, dayOfWeek, startTime, endTime FROM schedules LIMIT 15"
                c.execute(query)
                rows = c.fetchall()
                if rows:
                    sch_lines = ["### Schedules Table:"]
                    sch_lines.append("| ID | Title | Room | Instructor | Day | Time |")
                    sch_lines.append("|---|---|---|---|---|---|")
                    for r in rows:
                        sch_lines.append(f"| {r['id']} | {r['title'] or ''} | {r['room'] or ''} | {r['instructor'] or ''} | {r['dayOfWeek'] or ''} | {r['startTime'] or ''}-{r['endTime'] or ''} |")
                    context_parts.append("\n".join(sch_lines))

            # 5. Overview page (Concise combined summary: 5 users + 5 equipment + 5 logs)
            else:
                c.execute("SELECT id, name, role, status FROM users LIMIT 5")
                u_rows = c.fetchall()
                if u_rows:
                    context_parts.append("### Users Summary: " + ", ".join([f"{r['name']} ({r['role']})" for r in u_rows]))

                c.execute("SELECT id, name, status, borrowedByName FROM equipment LIMIT 5")
                eq_rows = c.fetchall()
                if eq_rows:
                    context_parts.append("### Equipment Summary: " + ", ".join([f"{r['name']} [{r['status']}]" for r in eq_rows]))

                c.execute("SELECT id, userName, status, timestamp FROM access_events ORDER BY id DESC LIMIT 5")
                log_rows = c.fetchall()
                if log_rows:
                    context_parts.append("### Recent Access Logs: " + ", ".join([f"{r['userName']} ({r['status']})" for r in log_rows]))

            conn.close()
        except Exception as e:
            logger.error(f"Error reading table context: {e}")
            context_parts.append(f"*(Unable to fetch table data: {e})*")

        return "\n\n".join(context_parts) if context_parts else "*(No table data available)*"

    def get_system_instructions(self, current_page: str = "overview") -> str:
        """
        Detailed system prompt instructing Qwen 2.5 Coder to act as an expert AI Assistant for Access Control System in English.
        """
        page_guides = {
            "overview": "Overview Page: Displays system stats, live feed, entry counts.",
            "users": "Users Page: Add users, assign roles (Student/Lecturer/Admin), register biometrics/PIN.",
            "enrollment": "Enrollment Page: Register Face ID (512-dim ArcFace embedding) and PIN codes.",
            "equipment": "Equipment Page: Inventory management, borrow/return workflows, overdue tracking.",
            "schedules": "Schedules Page: Manage practice sessions, import timetable .xlsx files.",
            "logs": "Logs Page: Audit RFID/Face access events, security violations, export reports.",
            "system": "System Page: Configure door nodes, face recognition threshold, MQTT broker IP."
        }

        active_guide = page_guides.get(current_page, page_guides["overview"])

        prompt = f"""You are **Qwen 2.5 Coder AI Assistant** for the **Lab Access Control Management System v2**.

### Duties:
1. **Analyze Table Data**: Read and summarize the table data provided in context below.
2. **User Guidance**: Provide concise step-by-step instructions for operating the system.
3. **Format**: Respond in clean Markdown (bullet lists, bold text, tables) in **English**.

### ⚠️ STRICT GROUNDING RULES:
- Do NOT fabricate or invent names, IDs, equipment, or stats.
- If data is not found in the context below, explicitly reply: *"This data is currently not available in the system"*.

### Page Context ({current_page.upper()}):
{active_guide}
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
        Send prompt and extracted table context to Qwen 2.5 Coder local API endpoint with 120s timeout and optimized prompt size.
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
            for item in history[-4:]: # Keep last 4 messages to save context memory
                role = item.get("role", "user")
                content = item.get("content", "")
                if role in ["user", "assistant"] and content:
                    messages.append({"role": role, "content": content})

        full_user_content = f"--- DATABASE CONTEXT ---\n{table_context}\n------------------------\n\nUser Request: {user_prompt}"
        messages.append({"role": "user", "content": full_user_content})

        payload = {
            "model": self.model_name,
            "messages": messages,
            "temperature": 0.0,
            "max_tokens": 384
        }

        try:
            req_url = f"{self.api_base}/chat/completions"
            data_bytes = json.dumps(payload).encode('utf-8')
            req = urllib.request.Request(req_url, data=data_bytes, headers={"Content-Type": "application/json"})
            
            if self.api_key:
                req.add_header("Authorization", f"Bearer {self.api_key}")

            # Increased socket timeout to 120 seconds for CPU execution
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
