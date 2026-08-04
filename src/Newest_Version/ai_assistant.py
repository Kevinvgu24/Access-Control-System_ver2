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
        self.model_name = os.getenv("QWEN_MODEL_NAME", "qwen2.5-coder:3b")
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
                    user_lines = ["### Bảng Người Dùng (Users Table):"]
                    user_lines.append("| ID | Họ và Tên | Mã Sinh Viên/GV | Email | Vai trò | Trạng thái | Khuôn mặt | PIN |")
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
                    eq_lines = ["### Bảng Thiết Bị (Equipment Table):"]
                    eq_lines.append("| ID | Tên Thiết Bị | Mã Code | Loại | Trạng Thái | Người Mượn | Hạn Trả | Ghi Chú |")
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
                    log_lines = ["### Bảng Nhật Ký Ra Vào (Access Events Logs):"]
                    log_lines.append("| ID | Người Thực Hiện | Phương Thức | Trạng Thái | Hợp Lệ | Thời Gian |")
                    log_lines.append("|---|---|---|---|---|---|")
                    for r in rows:
                        auth_str = "Hợp lệ" if r['isAuthorized'] else "Không hợp lệ"
                        log_lines.append(
                            f"| {r['id']} | {r['userName'] or 'Khách'} | {r['accessMethod'] or 'N/A'} | "
                            f"{r['status'] or ''} | {auth_str} | {r['timestamp'] or ''} |"
                        )
                    context_parts.append("\n".join(log_lines))

            # 4. Schedules Table
            if page in ["schedules", "overview", "all"]:
                query = "SELECT id, title, room, instructor, dayOfWeek, startTime, endTime, status FROM schedules LIMIT 20"
                c.execute(query)
                rows = c.fetchall()
                if rows:
                    sch_lines = ["### Bảng Lịch Trình (Schedules Table):"]
                    sch_lines.append("| ID | Tiêu Đề | Phòng | Giảng Viên | Thứ | Bắt Đầu | Kết Thúc | Trạng Thái |")
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
                    inc_lines = ["### Bảng Sự Cố & Cảnh Báo (Incidents Table):"]
                    inc_lines.append("| ID | Loại Sự Cố | Mức Độ | Mô Tả | Trạng Thái | Thời Gian |")
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
            context_parts.append(f"*(Không thể đọc dữ liệu bảng từ SQLite DB: {e})*")

        return "\n\n".join(context_parts) if context_parts else "*(Không có dữ liệu bảng khả dụng)*"

    def get_system_instructions(self, current_page: str = "overview") -> str:
        """
        Detailed system prompt instructing Qwen 2.5 Coder to act as an expert AI Assistant for Access Control System.
        """
        page_guides = {
            "overview": """
Trang Tổng Quan (Overview):
- Hiển thị thống kê tổng quan: Số lượng lượt vào/ra hôm nay, sự cố cảnh báo, số thiết bị đang mượn, trạng thái kết nối Camera & Node.
- Tính năng: Xem biểu đồ lưu lượng ra vào, theo dõi sự kiện trực tuyến (Live Feed), cảnh báo tức thời.
""",
            "users": """
Trang Quản Lý Người Dùng (Users):
- Danh sách sinh viên, giảng viên, quản trị viên có quyền truy cập Lab.
- Hướng dẫn:
  1. Thêm người dùng mới: Nhấn nút "+ Thêm người dùng", điền Tên, Mã SV/GV, Email, Vai trò (Student/Lecturer/Admin).
  2. Đăng ký Khuôn Mặt / Mã PIN: Chuyển sang trang "Đăng Ký" (Enrollment) hoặc bấm nút Đăng ký trên dòng của người dùng.
  3. Đổi trạng thái: Chọn Khóa (Disable) hoặc Hoạt động (Active) để cấp/thu hồi quyền mở cửa.
""",
            "enrollment": """
Trang Đăng Ký Dữ Liệu Sinh Trắc Học (Enrollment):
- Hướng dẫn Đăng ký Khuôn mặt (Face ID):
  1. Chọn tên người dùng cần đăng ký từ danh sách.
  2. Đảm bảo người dùng đứng trước camera IR/RGB của Node, mặt nhìn thẳng.
  3. Bấm "Bắt đầu chụp khuôn mặt", hệ thống trích xuất Feature Vector 512-dim (ArcFace / MobileFaceNet) và lưu vào SQLite DB.
- Hướng dẫn Đăng ký Mã PIN:
  1. Thao tác nhập PIN 4-6 chữ số trực tiếp hoặc qua bàn phím điều khiển.
""",
            "equipment": """
Trang Quản Lý Thiết Bị Phòng Lab (Equipment):
- Quản lý danh mục thiết bị, linh kiện, máy đo trong phòng Lab.
- Hướng dẫn mượn/trả thiết bị:
  1. Mượn thiết bị: Tìm thiết bị có trạng thái "Sẵn sàng" (Available) -> Bấm "Mượn thiết bị" -> Chọn người mượn và Ngày hẹn trả -> Xác nhận.
  2. Trả thiết bị: Bấm "Trả thiết bị" trên dòng thiết bị đang mượn (Borrowed/Overdue).
  3. Quá hạn: Thiết bị quá hạn trả sẽ có nhãn đỏ "Overdue", trợ lý có thể quét danh sách này để nhắc nhở.
""",
            "schedules": """
Trang Quản Lý Lịch Trình (Schedules):
- Quản lý lịch thực hành, thời khóa biểu cho phép tự động mở cửa phòng Lab theo khung giờ.
- Hướng dẫn:
  1. Thêm lịch thủ công: Nhập Tiêu đề môn học, Giảng viên, Thứ trong tuần, Giờ bắt đầu - Giờ kết thúc.
  2. Import từ tệp Excel: Nhấn "Nhập lịch Excel", chọn file .xlsx thời khóa biểu của trường để tự động đọc và map dữ liệu vào hệ thống.
""",
            "logs": """
Trang Nhật Ký & Cảnh Báo (Logs):
- Xem lại toàn bộ sự kiện quẹt thẻ RFID, nhận diện khuôn mặt, nhập PIN và cảnh báo vi phạm.
- Lọc theo: Ngày tháng, Phương thức (Face / RFID / PIN / App), Trạng thái (Thành công / Từ chối).
- Xuất báo cáo CSV/Excel.
""",
            "system": """
Trang Cấu Hình Hệ Thống & Thiết Bị Ngoại Vi (System/Nodes):
- Quản lý các Node mở cửa (Raspberry Pi / Hailo-8 AI Accelerator / ESP32 Subnodes).
- Cấu hình ngưỡng tin cậy nhận diện khuôn mặt (Face Recognition Threshold), thời gian giữ chốt cửa (Door Relay Time), địa chỉ MQTT Broker, IP Camera Stream.
"""
        }

        active_guide = page_guides.get(current_page, page_guides["overview"])

        prompt = f"""Bạn là **Qwen 2.5 Coder AI Assistant** - Trợ lý AI thông minh chuyên hỗ trợ người dùng vận hành **Hệ Thống Quản Lý Kiểm Soát Ra Vào Phòng Lab (Access Control System v2)**.

### Vai trò & Nhiệm vụ chính của bạn:
1. **Đọc & Phân tích bảng dữ liệu**: Phân tích chính xác dữ liệu bảng (Bảng người dùng, Bảng thiết bị, Lịch trình, Nhật ký ra vào, Cảnh báo sự cố) được cung cấp trong ngữ cảnh. Trả lời chi tiết các câu hỏi như số lượng, danh sách cụ thể, trạng thái, thiết bị quá hạn, lịch ra vào gần nhất.
2. **Hướng dẫn trực tiếp**: Hướng dẫn người dùng các bước thao tác chi tiết (Step-by-step) cách sử dụng từng chức năng trong phần mềm quản lý.
3. **Định dạng câu trả lời đẹp mắt**:
   - Sử dụng Markdown chuẩn (Bảng HTML/Markdown, Danh sách gạch đầu dòng, In đậm, Mã lệnh/Code block khi cần).
   - Câu trả lời ngắn gọn, súc tích, chuyên nghiệp và lịch sự bằng **Tiếng Việt**.

### Ngữ cảnh Trang Hiện Tại ({current_page.upper()}):
{active_guide}

Hãy trả lời chính xác, tin cậy dựa trên dữ liệu bảng thực tế và tài liệu hướng dẫn trên. Nếu câu hỏi yêu cầu phân tích dữ liệu bảng, hãy trích dẫn các hàng dữ liệu cụ thể từ ngữ cảnh bên dưới!
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
        Send prompt and extracted table context to Qwen 2.5 Coder local API endpoint.
        """
        # Check connection status
        status_info = self.check_status()
        if status_info["status"] == "offline":
            return {
                "success": False,
                "response": (
                    "⚠️ **Không thể kết nối đến Trợ lý AI Qwen 2.5 Coder!**\n\n"
                    "Dịch vụ LLM Qwen chưa được khởi chạy tại địa chỉ `" + self.api_base + "`.\n\n"
                    "**Hướng dẫn kích hoạt Qwen 2.5 Coder local:**\n"
                    "1. Cài đặt & chạy Ollama trên máy tính/server.\n"
                    "2. Mở terminal và chạy lệnh: `ollama run qwen2.5-coder:3b` (hoặc `1.5b`).\n"
                    "3. Đảm bảo cổng `11434` đang lắng nghe kết nối."
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
        full_user_content = f"--- DỮ LIỆU BẢNG THỰC TẾ TRÊN HỆ THỐNG ---\n{table_context}\n-------------------------------------------\n\nCâu hỏi/Yêu cầu của người dùng: {user_prompt}"
        messages.append({"role": "user", "content": full_user_content})

        payload = {
            "model": self.model_name,
            "messages": messages,
            "temperature": 0.3,
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
                        "response": f"Lỗi HTTP {resp.status} từ Qwen 2.5 Coder API."
                    }
        except Exception as e:
            logger.error(f"Error querying Qwen 2.5 Coder API: {e}")
            return {
                "success": False,
                "response": f"Có lỗi xảy ra khi xử lý yêu cầu với Qwen 2.5 Coder: {str(e)}"
            }
