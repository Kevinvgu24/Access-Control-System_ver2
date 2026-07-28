import urllib.request
import json

try:
    req = urllib.request.Request("http://127.0.0.1:5000/api/labs/304/access-events")
    with urllib.request.urlopen(req) as response:
        data = response.read().decode('utf-8')
        print(f"Status: {response.status}")
        parsed = json.loads(data)
        print(f"Num events: {len(parsed)}")
        if len(parsed) > 0:
            print(json.dumps(parsed[0], indent=2))
        else:
            print("Empty array!")
except Exception as e:
    print(f"Error: {e}")
