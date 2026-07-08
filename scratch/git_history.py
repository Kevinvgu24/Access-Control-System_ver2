import subprocess
try:
    out = subprocess.check_output(["git", "log", "-p", "-n", "3", "--", "src/Native_Tappas_CPP/face_align.cpp"], stderr=subprocess.STDOUT)
    with open("scratch/history.txt", "wb") as f:
        f.write(out)
    print("Success")
except Exception as e:
    print("Error:", e)
