import sys
import os
import re
import json
import shutil
import csv
from html.parser import HTMLParser

# Force stdout to UTF-8 to display Vietnamese characters correctly in Windows console
sys.stdout.reconfigure(encoding='utf-8')

class ExcelHTMLParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.raw_rows = []
        self.current_row = []
        self.in_cell = False
        self.cell_attrs = {}
        self.cell_text = []

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self.current_row = []
        elif tag in ("td", "th"):
            self.in_cell = True
            self.cell_attrs = dict(attrs)
            self.cell_text = []

    def handle_data(self, data):
        if self.in_cell:
            self.cell_text.append(data)

    def handle_endtag(self, tag):
        if tag in ("td", "th"):
            self.in_cell = False
            text = "".join(self.cell_text).strip()
            self.current_row.append({"text": text, "attrs": self.cell_attrs})
        elif tag == "tr":
            self.raw_rows.append(self.current_row)

class UniversalScheduleParser:
    def __init__(self, path):
        self.path = path.strip('"').strip("'")
        self.grid = []
        self.timeline = []
        self.students = []
        self.parsed_records = []
        self.dominant_color = "NO_COLOR"
        self.is_xlsx = False

    def parse(self):
        # Determine file type
        if os.path.isdir(self.path):
            html_files = [f for f in os.listdir(self.path) if f.endswith('.html')]
            if html_files:
                target_file = os.path.join(self.path, html_files[0])
                self.is_xlsx = False
                return self._parse_html(target_file)
            else:
                raise ValueError("Không tìm thấy tệp .html trong thư mục.")
        elif self.path.endswith('.html') or self.path.endswith('.htm'):
            self.is_xlsx = False
            return self._parse_html(self.path)
        elif self.path.endswith('.xlsx'):
            self.is_xlsx = True
            return self._parse_xlsx()
        else:
            raise ValueError("Định dạng tệp không được hỗ trợ (chỉ nhận thư mục HTML, tệp .html hoặc tệp .xlsx).")

    def _parse_html(self, file_path):
        print(f"Đang đọc tệp HTML: {file_path}...")
        with open(file_path, "r", encoding="utf-8") as f:
            html_content = f.read()

        # Parse CSS stylesheet colors
        class_colors = {}
        styles = re.findall(r'<style[^>]*>(.*?)</style>', html_content, re.DOTALL)
        if styles:
            style_content = styles[0]
            rules = re.findall(r'\.s(\d+)\b[^{]*\{([^}]+)\}', style_content)
            for cls_num, props in rules:
                bg_match = re.search(r'background-color\s*:\s*([^;]+)', props)
                if bg_match:
                    bg_color = bg_match.group(1).strip().lower()
                    class_colors[f"s{cls_num}"] = bg_color

        parser = ExcelHTMLParser()
        parser.feed(html_content)
        raw_rows = parser.raw_rows

        # Build 2D grid
        max_cols = 0
        for row in raw_rows:
            cols_in_row = 0
            for cell in row:
                cols_in_row += int(cell["attrs"].get("colspan", "1"))
            max_cols = max(max_cols, cols_in_row)

        self.grid = [[None for _ in range(max_cols)] for _ in range(len(raw_rows))]
        for r_idx, row in enumerate(raw_rows):
            c_idx = 0
            for cell in row:
                while c_idx < max_cols and self.grid[r_idx][c_idx] is not None:
                    c_idx += 1
                if c_idx >= max_cols:
                    break
                colspan = int(cell["attrs"].get("colspan", "1"))
                rowspan = int(cell["attrs"].get("rowspan", "1"))
                for dr in range(rowspan):
                    for dc in range(colspan):
                        tr = r_idx + dr
                        tc = c_idx + dc
                        if tr < len(self.grid) and tc < max_cols:
                            self.grid[tr][tc] = cell
                c_idx += colspan

        # Detect row indices dynamically
        y_r, m_r, d_r, dt_r, ma_r, s_r, h_r = self._detect_row_indices(self.grid, len(self.grid), max_cols, False)
        if None in (y_r, m_r, d_r, dt_r, ma_r, s_r, h_r):
            raise ValueError("Không thể phát hiện đầy đủ cấu trúc các dòng lịch trình (Năm, Tháng, Ngày, Ca, Phiên, Header).")

        # Parse timeline columns starting from column index 6
        self._parse_timeline_columns(y_r, m_r, d_r, dt_r, ma_r, s_r, start_col=6)

        # Parse student rows
        self._parse_students_rows(h_r, name_col=3, id_col=4, group_col=1, nr_col=2)

        # Detect dominant color (blocked cell color) in student schedule grid
        color_freq = {}
        for std in self.students:
            r_idx = std["row"]
            row = self.grid[r_idx]
            for c_idx in range(6, min(142, len(row))):
                cell = row[c_idx]
                if not cell:
                    continue
                cls = cell["attrs"].get("class", "")
                color = class_colors.get(cls, "NO_COLOR")
                color_freq[color] = color_freq.get(color, 0) + 1
        self.dominant_color = max(color_freq, key=color_freq.get) if color_freq else "NO_COLOR"

        # Resolve experiments and build schedule records
        group_experiments = {}
        for r_idx in range(h_r + 1, len(self.grid)):
            row = self.grid[r_idx]
            if len(row) < 5 or not row[1]:
                continue
            group_nr = row[1]["text"]
            for c_idx in range(6, min(142, len(row))):
                cell = row[c_idx]
                if cell and cell["text"]:
                    group_experiments[(group_nr, c_idx)] = cell["text"]

        self.parsed_records = []
        for std in self.students:
            r_idx = std["row"]
            group_nr = std["group"]
            row = self.grid[r_idx]

            for c_idx in range(6, min(142, len(row))):
                t_idx = c_idx - 6
                if t_idx >= len(self.timeline) or self.timeline[t_idx] is None:
                    continue

                t_info = self.timeline[t_idx]
                cell = row[c_idx]
                if not cell:
                    continue

                cls = cell["attrs"].get("class", "")
                color = class_colors.get(cls, "NO_COLOR")
                
                # Active if color is different from the dominant blocked color
                if color != self.dominant_color:
                    exp = cell["text"]
                    if not exp:
                        exp = group_experiments.get((group_nr, c_idx), "")

                    self.parsed_records.append({
                        "student_id": std["id"],
                        "student_name": std["name"],
                        "group_nr": group_nr,
                        "student_nr": std["nr"],
                        "date": t_info["date"],
                        "day_of_week": t_info["day"],
                        "ma": t_info["ma"],
                        "session_num": t_info["session"],
                        "experiment": exp
                    })
        return self.parsed_records

    def _parse_xlsx(self):
        print(f"Đang đọc tệp Excel (.xlsx): {self.path}...")
        import uuid
        temp_file = f"temp_parsing_schedule_{uuid.uuid4().hex}.xlsx"
        shutil.copy(self.path, temp_file)
        
        try:
            import openpyxl
            wb = openpyxl.load_workbook(temp_file, data_only=True)
            
            # Select correct sheet dynamically by scanning sheet names
            sheet_name = None
            for name in wb.sheetnames:
                if any(x in name.lower() for x in ['schedule', 'group', 'lịch', 'nhóm']):
                    sheet_name = name
                    break
            if sheet_name is None:
                sheet_name = wb.sheetnames[0]
                
            print(f"Đang phân tích trang tính (Sheet): '{sheet_name}'")
            ws = wb[sheet_name]
        except Exception as e:
            if os.path.exists(temp_file):
                os.remove(temp_file)
            raise RuntimeError(f"Không thể mở tệp Excel: {e}. Vui lòng cài đặt openpyxl bằng: pip install openpyxl")

        max_rows = ws.max_row
        max_cols = ws.max_column
        merged_ranges = ws.merged_cells.ranges
        
        # Read grid values and cell colors
        self.grid = [[{"text": "", "color": "NO_COLOR"} for _ in range(max_cols + 1)] for _ in range(max_rows + 1)]
        for r in range(1, max_rows + 1):
            for c in range(1, max_cols + 1):
                cell = ws.cell(row=r, column=c)
                val = cell.value
                txt = str(val).strip() if val is not None else ""
                
                # Clean floats generated by Excel (like 102240004.0 to 102240004)
                if txt.endswith(".0"):
                    try:
                        txt = str(int(float(txt)))
                    except ValueError:
                        pass
                        
                color = "NO_COLOR"
                fill = cell.fill
                if fill and fill.fill_type and fill.fill_type != 'none':
                    if hasattr(fill.fgColor, 'rgb') and fill.fgColor.rgb:
                        color = str(fill.fgColor.rgb)
                self.grid[r][c] = {"text": txt, "color": color}

        # Apply merged values to all spanned cells
        for merged_range in merged_ranges:
            min_col, min_row, max_col, max_row = merged_range.bounds
            origin_val = self.grid[min_row][min_col]
            for r in range(min_row, max_row + 1):
                for c in range(min_col, max_col + 1):
                    if r == min_row and c == min_col:
                        continue
                    self.grid[r][c]["text"] = origin_val["text"]

        # Detect row indices dynamically
        y_r, m_r, d_r, dt_r, ma_r, s_r, h_r = self._detect_row_indices(self.grid, max_rows, max_cols, True)
        if None in (y_r, m_r, d_r, dt_r, ma_r, s_r, h_r):
            if os.path.exists(temp_file): os.remove(temp_file)
            raise ValueError("Không thể phát hiện cấu trúc các dòng lịch trình (Năm, Tháng, Ngày, Ca, Phiên, Header).")

        # Parse timeline columns starting from Column G (7)
        self._parse_timeline_columns(y_r, m_r, d_r, dt_r, ma_r, s_r, start_col=7)

        # Parse student rows (Column C/3 is Name, Column D/4 is ID, Column A/1 is Group, Column B/2 is Nr)
        self._parse_students_rows(h_r, name_col=3, id_col=4, group_col=1, nr_col=2)

        # Detect dominant color in grid
        color_freq = {}
        for std in self.students:
            r_idx = std["row"]
            for c_idx in range(7, min(143, max_cols + 1)):
                cell = self.grid[r_idx][c_idx]
                color = cell["color"]
                color_freq[color] = color_freq.get(color, 0) + 1
        self.dominant_color = max(color_freq, key=color_freq.get) if color_freq else "NO_COLOR"

        # Resolve experiments and build schedule records
        group_experiments = {}
        for r_idx in range(h_r + 1, max_rows + 1):
            group_nr = self.grid[r_idx][1]["text"]
            if not group_nr or group_nr in ["MSE", "ICT", "Name ↓"]:
                continue
            for c_idx in range(7, min(143, max_cols + 1)):
                cell = self.grid[r_idx][c_idx]
                if cell and cell["text"]:
                    group_experiments[(group_nr, c_idx)] = cell["text"]

        self.parsed_records = []
        for std in self.students:
            r_idx = std["row"]
            group_nr = std["group"]

            for c_idx in range(7, min(143, max_cols + 1)):
                t_idx = c_idx - 7
                if t_idx >= len(self.timeline) or self.timeline[t_idx] is None:
                    continue

                t_info = self.timeline[t_idx]
                cell = self.grid[r_idx][c_idx]
                
                # Active if color is different from the dominant blocked color
                if cell["color"] != self.dominant_color:
                    exp = cell["text"]
                    if not exp:
                        exp = group_experiments.get((group_nr, c_idx), "")

                    self.parsed_records.append({
                        "student_id": std["id"],
                        "student_name": std["name"],
                        "group_nr": group_nr,
                        "student_nr": std["nr"],
                        "date": t_info["date"],
                        "day_of_week": t_info["day"],
                        "ma": t_info["ma"],
                        "session_num": t_info["session"],
                        "experiment": exp
                    })

        if os.path.exists(temp_file):
            os.remove(temp_file)
            
        return self.parsed_records

    def _detect_row_indices(self, grid, max_rows, max_cols, is_xlsx):
        """Find Year, Month, Day, Date, Session, and Header row indices dynamically."""
        y_r = m_r = d_r = dt_r = ma_r = s_r = h_r = None
        limit_col = min(7, max_cols)
        
        start_idx = 1 if is_xlsx else 0
        end_idx = max_rows + 1 if is_xlsx else max_rows
        
        for r in range(start_idx, end_idx):
            if is_xlsx:
                row_txts = [grid[r][c]["text"].strip().lower() for c in range(1, limit_col + 1)]
            else:
                row = grid[r]
                if not row: continue
                row_txts = [cell["text"].strip().lower() if cell else "" for cell in row[:limit_col]]
                
            if "year" in row_txts and y_r is None: y_r = r
            if "month" in row_txts and m_r is None: m_r = r
            if "day" in row_txts and d_r is None: d_r = r
            if "date" in row_txts and dt_r is None: dt_r = r
            if any("morning/afternoon" in t or "(m/a)" in t for t in row_txts) and ma_r is None: ma_r = r
            if any("session" in t for t in row_txts) and s_r is None: s_r = r
            if any("group nr" in t or "name ↓" in t or "id ↓" in t for t in row_txts) and h_r is None: h_r = r
            
        return y_r, m_r, d_r, dt_r, ma_r, s_r, h_r

    def _parse_timeline_columns(self, y_r, m_r, d_r, dt_r, ma_r, s_r, start_col):
        """Construct date and ca information for each timeline column."""
        def get_texts(r):
            if self.is_xlsx:
                return [self.grid[r][c]["text"] for c in range(1, len(self.grid[r]))]
            else:
                return [self.grid[r][c]["text"] if self.grid[r][c] else "" for c in range(len(self.grid[r]))]
                
        years_raw = get_texts(y_r)
        months_raw = get_texts(m_r)
        days_raw = get_texts(d_r)
        dates_raw = get_texts(dt_r)
        mas_raw = get_texts(ma_r)
        sessions_raw = get_texts(s_r)
        
        def propagate(lst):
            res = []
            curr = ""
            for val in lst:
                if val: curr = val
                res.append(curr)
            return res

        # Year and Month are merged headers, so propagate them
        years = propagate(years_raw)
        months = propagate(months_raw)
        # Day, Date, M/A and Session are column-specific, do NOT propagate
        days = days_raw
        dates = dates_raw
        mas = mas_raw
        sessions = sessions_raw

        offset = 1 if self.is_xlsx else 0
        
        self.timeline = []
        for c in range(start_col, len(self.grid[0]) if not self.is_xlsx else len(self.grid[0])):
            idx = c - offset
            if idx >= len(dates):
                self.timeline.append(None)
                continue
            date_val = dates[idx]
            
            # Clean floating representations in Excel like '23.0' to '23'
            if date_val.endswith('.0'):
                try: date_val = str(int(float(date_val)))
                except ValueError: pass
                
            if not date_val or not date_val.isdigit():
                self.timeline.append(None)
                continue
                
            day_num = int(date_val)
            year_val = years[idx]
            if year_val.endswith('.0'):
                try: year_val = str(int(float(year_val)))
                except ValueError: pass
            month_val = months[idx]
            if month_val.endswith('.0'):
                try: month_val = str(int(float(month_val)))
                except ValueError: pass
                
            year = int(year_val) if year_val.isdigit() else 2026
            if year < 100:
                year += 2000
                
            month = int(month_val) if month_val.isdigit() else 3
            date_str = f"{year:04d}-{month:02d}-{day_num:02d}"

            s_val = sessions[idx]
            if s_val.endswith('.0'):
                try: s_val = str(int(float(s_val)))
                except ValueError: pass

            self.timeline.append({
                "col": c,
                "date": date_str,
                "day": days[idx],
                "ma": mas[idx],
                "session": s_val
            })

    def _parse_students_rows(self, h_r, name_col, id_col, group_col, nr_col):
        """Parse student info (skipping sub-headers)."""
        self.students = []
        start_idx = h_r + 1
        end_idx = len(self.grid)
        
        for r in range(start_idx, end_idx):
            row = self.grid[r]
            if not row or len(row) < 5: continue
            
            group_nr = row[group_col]["text"] if row[group_col] else ""
            student_nr = row[nr_col]["text"] if row[nr_col] else ""
            name = row[name_col]["text"] if row[name_col] else ""
            std_id = row[id_col]["text"] if row[id_col] else ""

            if not name and not std_id: continue
            if name in ["Name ↓", "MSE", "ICT"] or name.startswith("Students:"): continue
            
            self.students.append({
                "row": r,
                "group": group_nr,
                "nr": student_nr,
                "name": name,
                "id": std_id
            })

def print_menu():
    print("\n" + "="*50)
    print("      HỆ THỐNG TRA CỨU LỊCH TRÌNH PHÒNG LAB      ")
    print("="*50)
    print(" [1] Hiển thị tất cả lịch đi Lab (Rút gọn 30 dòng đầu)")
    print(" [2] Tra cứu lịch theo Tên sinh viên hoặc MSSV")
    print(" [3] Tra cứu danh sách lên lab theo Ngày (YYYY-MM-DD)")
    print(" [4] Xuất toàn bộ dữ liệu ra tệp tin CSV")
    print(" [5] Thoát chương trình")
    print("="*50)

def main():
    default_path = r"c:\Users\Phant\Downloads\ECE2024_ICT & MSE major_Com. Eng Lab_Schedule & Group_20260401.xlsx"
    
    print("Chào mừng bạn đến với chương trình đọc lịch trình đi Lab.")
    print(f"Đường dẫn mặc định gợi ý:\n  {default_path}")
    path_input = input("Nhập đường dẫn file (hoặc nhấn Enter để dùng mặc định): ").strip()
    
    if not path_input:
        path_input = default_path

    if not os.path.exists(path_input):
        print(f"Lỗi: Đường dẫn '{path_input}' không tồn tại. Vui lòng kiểm tra lại.")
        return

    try:
        parser = UniversalScheduleParser(path_input)
        records = parser.parse()
        print(f"\nPhân tích thành công! Tìm thấy:")
        print(f"  - Số sinh viên: {len(parser.students)}")
        print(f"  - Số lượt đi Lab: {len(records)}")
    except Exception as e:
        print(f"\nLỗi khi phân tích tệp: {e}")
        return

    while True:
        print_menu()
        choice = input("Lựa chọn của bạn (1-5): ").strip()
        
        if choice == '1':
            print(f"\n--- 30 LƯỢT ĐI LAB ĐẦU TIÊN (Tổng số: {len(records)} lượt) ---")
            print(f"{'MSSV':<10} | {'Họ và Tên':<25} | {'Nhóm':<5} | {'Ngày':<10} | {'Thứ':<4} | {'Buổi':<5} | {'Phiên':<5} | {'Bài thí nghiệm'}")
            print("-" * 90)
            for r in records[:30]:
                print(f"{r['student_id']:<10} | {r['student_name']:<25} | {r['group_nr']:<5} | {r['date']:<10} | {r['day_of_week']:<4} | {r['ma']:<5} | {r['session_num']:<5} | {r['experiment']}")
            if len(records) > 30:
                print(f"... và còn {len(records) - 30} lượt khác.")

        elif choice == '2':
            query = input("Nhập Tên sinh viên hoặc MSSV cần tra cứu: ").strip().lower()
            if not query:
                continue
            
            results = [r for r in records if query in r['student_name'].lower() or query == r['student_id'].lower()]
            
            if not results:
                print(f"\nKhông tìm thấy lịch trình nào cho sinh viên: '{query}'")
            else:
                print(f"\n--- KẾT QUẢ TRA CỨU SINH VIÊN: {results[0]['student_name']} (MSSV: {results[0]['student_id']}) ---")
                print(f"{'Ngày':<10} | {'Thứ':<4} | {'Buổi':<5} | {'Phiên':<5} | {'Bài thí nghiệm'}")
                print("-" * 50)
                for r in results:
                    print(f"{r['date']:<10} | {r['day_of_week']:<4} | {r['ma']:<5} | {r['session_num']:<5} | {r['experiment']}")

        elif choice == '3':
            date_query = input("Nhập ngày cần tra cứu (Định dạng YYYY-MM-DD, VD: 2026-04-17): ").strip()
            if not date_query:
                continue
            
            results = [r for r in records if r['date'] == date_query]
            
            if not results:
                print(f"\nKhông có sinh viên nào lịch lên lab vào ngày '{date_query}'.")
            else:
                print(f"\n--- DANH SÁCH LÊN LAB NGÀY: {date_query} (Tổng số: {len(results)} sinh viên) ---")
                print(f"{'MSSV':<10} | {'Họ và Tên':<25} | {'Nhóm':<5} | {'Buổi':<5} | {'Phiên':<5} | {'Bài thí nghiệm'}")
                print("-" * 80)
                for r in results:
                    print(f"{r['student_id']:<10} | {r['student_name']:<25} | {r['group_nr']:<5} | {r['ma']:<5} | {r['session_num']:<5} | {r['experiment']}")

        elif choice == '4':
            output_csv = "danh_sach_di_lab_loc.csv"
            try:
                with open(output_csv, "w", newline="", encoding="utf-8-sig") as csvfile:
                    fieldnames = ["student_id", "student_name", "group_nr", "student_nr", "date", "day_of_week", "ma", "session_num", "experiment"]
                    writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
                    
                    writer.writeheader()
                    for r in records:
                        writer.writerow(r)
                print(f"\nXuất dữ liệu thành công ra file: '{os.path.abspath(output_csv)}'")
            except Exception as e:
                print(f"\nLỗi khi xuất file CSV: {e}")

        elif choice == '5':
            print("Cảm ơn bạn đã sử dụng chương trình!")
            break
        else:
            print("Lựa chọn không hợp lệ, vui lòng chọn lại (1-5).")

if __name__ == "__main__":
    main()
