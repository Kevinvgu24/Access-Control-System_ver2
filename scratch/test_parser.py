import sys
sys.path.append("/home/kevinvgu/Access-Control-System_ver2")
from run_schedule_parser import UniversalScheduleParser

def test_parse():
    try:
        parser = UniversalScheduleParser("temp.xlsx", template_type="type1")
        records = parser.parse()
        print(f"SUCCESS: Parsed {len(records)} records successfully!")
        if records:
            print("First 3 records:")
            for r in records[:3]:
                print(r)
    except Exception as e:
        print(f"FAILED with error: {e}")

if __name__ == "__main__":
    test_parse()
