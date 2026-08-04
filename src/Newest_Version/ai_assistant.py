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
            
            with urllib.request.urlopen(req, timeout=3) as resp:
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
        Extract relevant table data from SQLite DB formatted cleanly as Markdown for Qwen 2.5 Coder.
        """
        context_parts = []
        try:
            conn = self._get_db_connection()
            c = conn.cursor()

            # 1. Users Table
            if page in ["users", "enrollment", "overview", "all"]:
                query = "SELECT id, name, university_id, email, role, status, faceStatus, pinStatus, createdAt FROM users LIMIT 30"
                c.execute(query)
                rows = c.fetchall()
                if rows:
                    user_lines = ["### Users Table:"]
                    user_lines.append("| ID | Name | Student/Staff ID | Email | Role | Status | Face ID | PIN |")
                    user_lines.append("|---|---|---|---|---|---|---|---|")
                    for r in rows:
                        user_lines.append(
                            f"| {r['id']} | {r['name'] or ''} | {r['university_id'] or ''} | {r['email'] or ''} | "
                            f"{r['role'] or ''} | {r['status'] or ''} | {r['faceStatus'] or ''} | {r['pinStatus'] or ''} |"
                        )
                    context_parts.append("\n".join(user_lines))

            # 2. Equipment Table
            if page in ["equipment", "overview", "all"]:
                query = "SELECT id, name, code, category, status, borrowedBy, borrowedByName, dueDate, notes FROM equipment"
                if lab_id:
                    query += " WHERE labId = ?"
                    c.execute(query + " LIMIT 30", (lab_id,))
                else:
                    c.execute(query + " LIMIT 30")
                rows = c.fetchall()
                if rows:
                    eq_lines = ["### Equipment Table:"]
                    eq_lines.append("| ID | Equipment Name | Code | Category | Status | Borrower | Due Date | Notes |")
                    eq_lines.append("|---|---|---|---|---|---|---|---|")
                    for r in rows:
                        eq_lines.append(
                            f"| {r['id']} | {r['name'] or ''} | {r['code'] or ''} | {r['category'] or ''} | "
                            f"{r['status'] or ''} | {r['borrowedByName'] or r['borrowedBy'] or 'N/A'} | {r['dueDate'] or 'N/A'} | {r['notes'] or ''} |"
                        )
                    context_parts.append("\n".join(eq_lines))

            # 3. Access Events / Logs Table
            if page in ["logs", "overview", "all"]:
                query = "SELECT id, userName, accessMethod, status, isAuthorized, timestamp FROM access_events ORDER BY id DESC LIMIT 20"
                c.execute(query)
                rows = c.fetchall()
                if rows:
                    log_lines = ["### Access Events Logs Table:"]
                    log_lines.append("| ID | User | Method | Status | Authorized | Timestamp |")
                    log_lines.append("|---|---|---|---|---|---|")
                    for r in rows:
                        auth_str = "Authorized" if r['isAuthorized'] else "Unauthorized"
                        log_lines.append(
                            f"| {r['id']} | {r['userName'] or 'Guest'} | {r['accessMethod'] or 'N/A'} | "
                            f"{r['status'] or ''} | {auth_str} | {r['timestamp'] or ''} |"
                        )
                    context_parts.append("\n".join(log_lines))

            # 4. Schedules Table
            if page in ["schedules", "overview", "all"]:
                query = "SELECT id, title, room, instructor, dayOfWeek, startTime, endTime, status FROM schedules LIMIT 20"
                c.execute(query)
                rows = c.fetchall()
                if rows:
                    sch_lines = ["### Schedules Table:"]
                    sch_lines.append("| ID | Course Title | Room | Instructor | Day | Start Time | End Time | Status |")
                    sch_lines.append("|---|---|---|---|---|---|---|---|")
                    for r in rows:
                        sch_lines.append(
                            f"| {r['id']} | {r['title'] or ''} | {r['room'] or ''} | {r['instructor'] or ''} | "
                            f"{r['dayOfWeek'] or ''} | {r['startTime'] or ''} | {r['endTime'] or ''} | {r['status'] or ''} |"
                        )
                    context_parts.append("\n".join(sch_lines))

            # 5. Incidents Table
            if page in ["logs", "system", "overview", "all"]:
                query = "SELECT id, type, severity, description, status, timestamp FROM incidents ORDER BY id DESC LIMIT 10"
                c.execute(query)
                rows = c.fetchall()
                if rows:
                    inc_lines = ["### Incidents & Security Alerts Table:"]
                    inc_lines.append("| ID | Incident Type | Severity | Description | Status | Timestamp |")
                    inc_lines.append("|---|---|---|---|---|---|")
                    for r in rows:
                        inc_lines.append(
                            f"| {r['id']} | {r['type'] or ''} | {r['severity'] or ''} | {r['description'] or ''} | "
                            f"{r['status'] or ''} | {r['timestamp'] or ''} |"
                        )
                    context_parts.append("\n".join(inc_lines))

            conn.close()
        except Exception as e:
            logger.error(f"Error reading table context: {e}")
            context_parts.append(f"*(Unable to fetch table data from SQLite DB: {e})*")

        return "\n\n".join(context_parts) if context_parts else "*(No table data available)*"

    def get_system_instructions(self, current_page: str = "overview") -> str:
        """
        Detailed system prompt instructing Qwen 2.5 Coder to act as an expert AI Assistant for Access Control System in English.
        """
        page_guides = {
            "overview": """
Overview Page:
- Displays overall system statistics: Today's entry/exit count, security incidents, borrowed equipment count, Camera & Node connection status.
- Features: View traffic analytics charts, monitor real-time Live Activity Feed, instant security alerts.
""",
            "users": """
User Management Page (Users):
- List of students, lecturers, and administrators authorized for lab access.
- User Guide:
  1. Add New User: Click "+ Add User", enter Name, Student/Staff ID, Email, and Role (Student/Lecturer/Admin).
  2. Register Biometrics / PIN: Go to "Enrollment" page or click Register on the user row.
  3. Change Status: Toggle between Disable and Active to grant/revoke door access.
""",
            "enrollment": """
Biometric & Credentials Registration Page (Enrollment):
- Face Recognition (Face ID) Registration Guide:
  1. Select target user from the dropdown list.
  2. Ensure user stands in front of the Node IR/RGB camera facing straight.
  3. Click "Start Face Capture" -> System extracts 512-dim embedding (ArcFace/MobileFaceNet) and saves to SQLite DB.
- PIN Code Registration Guide:
  1. Input 4-6 digit PIN directly or via keypad control.
""",
            "equipment": """
Lab Equipment Management Page (Equipment):
- Manage lab instruments, tools, and hardware equipment inventory.
- Borrow / Return Workflow:
  1. Borrow: Find equipment marked "Available" -> Click "Borrow Equipment" -> Select borrower & Due Date -> Confirm.
  2. Return: Click "Return Equipment" on borrowed/overdue item rows.
  3. Overdue: Overdue items display red "Overdue" badge for easy auditing.
""",
            "schedules": """
Schedule Management Page (Schedules):
- Manage lab timetables and practice sessions to automatically unlock doors during scheduled hours.
- User Guide:
  1. Manual Schedule Creation: Input Course Title, Instructor, Day of week, Start/End times.
  2. Import Excel: Click "Import Excel", select school timetable .xlsx file to automatically parse and map schedule.
""",
            "logs": """
Access Logs & Incidents Page (Logs):
- Audit all RFID card swipes, Face ID scans, PIN entries, and security violation alerts.
- Filter by: Date range, Access Method (Face / RFID / PIN / App), Authorization Status (Success / Denied).
- Export CSV/Excel reports.
""",
            "system": """
System Configuration & Hardware Nodes Page (System/Nodes):
- Manage door control nodes (Raspberry Pi / Hailo-8 AI Accelerator / ESP32 Subnodes).
- Configure Face Recognition Threshold, Door Relay Lock Time, MQTT Broker Host/Port, IP Camera Stream URL.
"""
        }

        active_guide = page_guides.get(current_page, page_guides["overview"])

        prompt = f"""You are **Qwen 2.5 Coder AI Assistant** - an intelligent AI Assistant supporting users operating the **Lab Access Control Management System v2**.

### Your Core Duties & Guidelines:
1. **Analyze Table Data**: Accurately read and analyze table data (Users, Equipment, Schedules, Access Logs, Security Alerts) provided in the context below. Answer specific questions regarding counts, statuses, overdue equipment, or recent access events.
2. **Interactive Guidance**: Provide step-by-step instructions on how to use system features clearly and concisely.
3. **Response Formatting**:
   - Use standard Markdown (HTML/Markdown tables, bullet lists, bold text, code blocks when necessary).
   - Always respond clearly, concisely, and professionally in **English**.

### ⚠️ STRICT GROUNDING & NO HALLUCINATION RULES:
- **FACTUAL DATABASE REASONING ONLY**: You MUST NOT fabricate, invent, or speculate any data, user names, equipment codes, or statistics that do not appear in the context.
- **CONTEXT BOUNDARIES**: Rely strictly on the provided table data and user guide context below.
- **DATA MISSING HANDLING**: If the requested information or data DOES NOT EXIST or CANNOT BE FOUND in the table context, you MUST explicitly state: *"This data is currently not available in the system"* or *"No corresponding information found in the database"*. Do NOT generate placeholder or dummy data!

### Current Page Context ({current_page.upper()}):
{active_guide}

Check the actual table data below carefully before responding. If data is missing, explicitly state that it is not available in the system!
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
        Send prompt and extracted table context to Qwen 2.5 Coder local API endpoint in English.
        """
        # Check connection status
        status_info = self.check_status()
        if status_info["status"] == "offline":
            return {
                "success": False,
                "response": (
                    "⚠️ **Unable to connect to Qwen 2.5 Coder AI Service!**\n\n"
                    "The local LLM service is not running at `" + self.api_base + "`.\n\n"
                    "**How to start Qwen 2.5 Coder locally:**\n"
                    "1. Start Ollama service on host/container.\n"
                    "2. Run command in terminal: `ollama run qwen2.5-coder:1.5b`.\n"
                    "3. Ensure port `11434` is accessible."
                ),
                "offline": True
            }

        # Build Context
        table_context = custom_table_data or self.extract_table_context(lab_id=lab_id, page=current_page)
        system_instructions = self.get_system_instructions(current_page=current_page)

        messages = [
            {"role": "system", "content": system_instructions}
        ]

        # Add existing conversation history
        if history:
            for item in history[-6:]: # Keep last 6 messages for conversation memory
                role = item.get("role", "user")
                content = item.get("content", "")
                if role in ["user", "assistant"] and content:
                    messages.append({"role": role, "content": content})

        # Final message combining table data & user question
        full_user_content = f"--- REAL-TIME SYSTEM DATABASE TABLE CONTEXT ---\n{table_context}\n-----------------------------------------------\n\nUser Question/Request: {user_prompt}"
        messages.append({"role": "user", "content": full_user_content})

        payload = {
            "model": self.model_name,
            "messages": messages,
            "temperature": 0.0,  # Zero temperature to enforce factual grounding and eliminate hallucinations
            "max_tokens": 1024
        }

        try:
            req_url = f"{self.api_base}/chat/completions"
            data_bytes = json.dumps(payload).encode('utf-8')
            req = urllib.request.Request(req_url, data=data_bytes, headers={"Content-Type": "application/json"})
            
            if self.api_key:
                req.add_header("Authorization", f"Bearer {self.api_key}")

            with urllib.request.urlopen(req, timeout=30) as resp:
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
