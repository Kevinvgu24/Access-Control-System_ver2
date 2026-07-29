import sys
import os
import urllib.request
import json

current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)
newest_version_dir = os.path.join(os.path.dirname(parent_dir), "Newest_Version")

for d in [current_dir, parent_dir, newest_version_dir]:
    if d not in sys.path:
        sys.path.insert(0, d)

from qt_imports import QWidget, QLabel, QPushButton, QVBoxLayout, QHBoxLayout, QLineEdit, pyqtSignal, Qt, QMessageBox
from lab_config import get_lab_config, save_lab_config

class LabWidget(QWidget):
    lab_code_changed = pyqtSignal(str)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.init_ui()

    def init_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(14, 14, 14, 14)
        layout.setSpacing(10)

        # Header Title
        lbl_title = QLabel("🔐 RASPBERRY PI 5 NODE ACTIVATION & BINDING")
        lbl_title.setStyleSheet("color: #ea580c; font-size: 15px; font-weight: bold;")
        lbl_title.setAlignment(Qt.AlignCenter)
        layout.addWidget(lbl_title)

        # Current Activation Status Card
        cfg = get_lab_config()
        act_time = cfg.get('activated_at', 'N/A')
        act_by = cfg.get('activated_by', 'N/A')

        status_text = (
            f"LAB: {cfg['lab_code']} | STATUS: {'✓ ACTIVATED' if cfg['is_activated'] else '⚠️ PENDING ACTIVATION'}\n"
            f"🕒 Kích hoạt: {act_time if cfg['is_activated'] else 'Chưa kích hoạt'} | 👤 Người kích hoạt: {act_by if cfg['is_activated'] else 'Chưa xác định'}"
        )
        self.lblCurrentLab = QLabel(status_text)
        self.lblCurrentLab.setAlignment(Qt.AlignCenter)
        status_bg = "#f0fdf4" if cfg['is_activated'] else "#fff7ed"
        status_color = "#15803d" if cfg['is_activated'] else "#c2410c"
        status_border = "#86efac" if cfg['is_activated'] else "#fdba74"
        self.lblCurrentLab.setStyleSheet(f"""
            background-color: {status_bg};
            color: {status_color};
            border: 2px solid {status_border};
            border-radius: 8px;
            padding: 8px;
            font-size: 12px;
            font-weight: bold;
        """)
        layout.addWidget(self.lblCurrentLab)

        # Parallel AI Preload Badge Status
        self.lblPreloadStatus = QLabel("⚡ AI Face Recognition Models: Preloading in parallel...")
        self.lblPreloadStatus.setAlignment(Qt.AlignCenter)
        self.lblPreloadStatus.setStyleSheet("""
            background-color: #eff6ff;
            color: #1d4ed8;
            border: 1px solid #bfdbfe;
            border-radius: 6px;
            padding: 5px;
            font-size: 11px;
            font-weight: bold;
        """)
        layout.addWidget(self.lblPreloadStatus)

        # Instruction Note
        lbl_instruct = QLabel(
            "Enter Lab Name, Lab Code, and Administrator Activation Code (found under System on Web App):"
        )
        lbl_instruct.setStyleSheet("color: #475569; font-size: 11px;")
        lbl_instruct.setWordWrap(True)
        layout.addWidget(lbl_instruct)

        # Field 1: Lab Name
        lbl_name = QLabel("Lab Name:")
        lbl_name.setStyleSheet("color: #334155; font-size: 12px; font-weight: bold;")
        layout.addWidget(lbl_name)

        self.inputLabName = QLineEdit()
        self.inputLabName.setText(cfg.get('lab_name', ''))
        self.inputLabName.setPlaceholderText("e.g., Lab Room 304 / IoT Lab")
        self.inputLabName.setMinimumHeight(38)
        self.inputLabName.setStyleSheet("""
            QLineEdit {
                background-color: #ffffff;
                color: #0f172a;
                font-size: 13px;
                font-weight: bold;
                border: 1.5px solid #cbd5e1;
                border-radius: 6px;
                padding: 4px 10px;
            }
            QLineEdit:focus { border-color: #ea580c; }
        """)
        layout.addWidget(self.inputLabName)

        # Field 2: Lab Code
        lbl_code = QLabel("Lab Code:")
        lbl_code.setStyleSheet("color: #334155; font-size: 12px; font-weight: bold;")
        layout.addWidget(lbl_code)

        self.inputLabCode = QLineEdit()
        self.inputLabCode.setText(cfg.get('lab_code', ''))
        self.inputLabCode.setPlaceholderText("e.g., 304 or Lab_1")
        self.inputLabCode.setMinimumHeight(38)
        self.inputLabCode.setStyleSheet("""
            QLineEdit {
                background-color: #ffffff;
                color: #0f172a;
                font-size: 13px;
                font-weight: bold;
                border: 1.5px solid #cbd5e1;
                border-radius: 6px;
                padding: 4px 10px;
            }
            QLineEdit:focus { border-color: #ea580c; }
        """)
        layout.addWidget(self.inputLabCode)

        # Field 3: Admin Activation Code
        lbl_act = QLabel("Admin Activation Code:")
        lbl_act.setStyleSheet("color: #ea580c; font-size: 12px; font-weight: bold;")
        layout.addWidget(lbl_act)

        self.inputActivationCode = QLineEdit()
        self.inputActivationCode.setText(cfg.get('activation_code', ''))
        self.inputActivationCode.setPlaceholderText("e.g., ACT-8F3K9A (see Web App)")
        self.inputActivationCode.setMinimumHeight(38)
        self.inputActivationCode.setStyleSheet("""
            QLineEdit {
                background-color: #ffffff;
                color: #ea580c;
                font-size: 13px;
                font-weight: bold;
                border: 2px solid #fdba74;
                border-radius: 6px;
                padding: 4px 10px;
            }
            QLineEdit:focus { border-color: #ea580c; }
        """)
        layout.addWidget(self.inputActivationCode)

        layout.addStretch()

        # Save & Activate Button
        self.btnSave = QPushButton("🔑 ACTIVATING & BINDING NODE TO LAB")
        self.btnSave.setMinimumHeight(48)
        self.btnSave.setStyleSheet("""
            QPushButton {
                background-color: #ea580c;
                color: white;
                font-weight: bold;
                font-size: 14px;
                border-radius: 8px;
                border: none;
            }
            QPushButton:pressed { background-color: #c2410c; }
            QPushButton:disabled { background-color: #94a3b8; }
        """)
        self.btnSave.clicked.connect(self.verify_and_activate)
        layout.addWidget(self.btnSave)

    def set_preload_done(self):
        self.lblPreloadStatus.setText("✓ AI Face Recognition Engine: Ready & Preloaded")
        self.lblPreloadStatus.setStyleSheet("""
            background-color: #f0fdf4;
            color: #166534;
            border: 1px solid #bbf7d0;
            border-radius: 6px;
            padding: 5px;
            font-size: 11px;
            font-weight: bold;
        """)

    def verify_and_activate(self):
        lab_name = self.inputLabName.text().strip()
        lab_code = self.inputLabCode.text().strip()
        act_code = self.inputActivationCode.text().strip()

        if not lab_code or not act_code:
            QMessageBox.warning(
                self, "Missing Information",
                "Please enter both Lab Code and Activation Code!"
            )
            return

        server_url = os.environ.get("SERVER_URL", "http://192.168.1.244:5000")
        verify_endpoint = f"{server_url}/api/labs/verify-activation"

        payload = json.dumps({
            "lab_name": lab_name,
            "lab_code": lab_code,
            "activation_code": act_code
        }).encode("utf-8")

        req = urllib.request.Request(
            verify_endpoint,
            data=payload,
            headers={"Content-Type": "application/json", "User-Agent": "RPi5NodeSetup/1.0"},
            method="POST"
        )

        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                result = json.loads(resp.read().decode("utf-8"))
                if result.get("success"):
                    lab_info = result.get("lab", {})
                    confirmed_code = lab_info.get("code", lab_code)
                    confirmed_name = lab_info.get("name", lab_name)
                    act_at = lab_info.get("activatedAt", "29/07/2026 01:57:39")
                    act_by = lab_info.get("activatedBy", "Kevin (dawnnkevin9@gmail.com)")

                    save_lab_config(
                        lab_code=confirmed_code,
                        lab_name=confirmed_name,
                        activation_code=act_code,
                        is_activated=True,
                        activated_at=act_at,
                        activated_by=act_by
                    )

                    self.lblCurrentLab.setText(
                        f"LAB: {confirmed_code} | STATUS: ✓ ACTIVATED\n"
                        f"🕒 Activated: {act_at} | 👤 Activated by: {act_by}"
                    )
                    self.lblCurrentLab.setStyleSheet("""
                        background-color: #f0fdf4;
                        color: #15803d;
                        border: 2px solid #86efac;
                        border-radius: 8px;
                        padding: 8px;
                        font-size: 12px;
                        font-weight: bold;
                    """)

                    self.lab_code_changed.emit(confirmed_code)

                    QMessageBox.information(
                        self, "Activation Successful",
                        f"🎉 Raspberry Pi 5 node activated successfully!\n\n"
                        f"🏫 Lab Room: {confirmed_name} ({confirmed_code})\n"
                        f"🕒 Activation Date/Time: {act_at}\n"
                        f"👤 Activated By (Admin): {act_by}\n\n"
                        "Configuration saved permanently."
                    )
                else:
                    err_msg = result.get("error", "Activation failed! Activation code does not match.")
                    QMessageBox.critical(self, "Activation Error", err_msg)
        except Exception as e:
            # Fallback local bypass for offline setup or master pin override
            if act_code == "ADMIN123":
                import datetime
                now_str = datetime.datetime.now().strftime("%d/%m/%Y %H:%M:%S")
                save_lab_config(
                    lab_code=lab_code,
                    lab_name=lab_name,
                    activation_code=act_code,
                    is_activated=True,
                    activated_at=now_str,
                    activated_by="Offline Master Admin"
                )
                self.lblCurrentLab.setText(
                    f"LAB: {lab_code} | STATUS: ✓ ACTIVATED (Offline Bypass)\n"
                    f"🕒 Kích hoạt: {now_str} | 👤 Người kích hoạt: Offline Master Admin"
                )
                self.lab_code_changed.emit(lab_code)
                QMessageBox.information(self, "Offline Bypass", f"Đã kích hoạt chế độ Offline cho Lab '{lab_code}'.")
            else:
                QMessageBox.critical(
                    self, "Lỗi Kết Nối Server",
                    f"Không thể kết nối đến máy chủ Web Server ({server_url}) để xác thực mã activation code!\n"
                    f"Chi tiết: {e}"
                )
