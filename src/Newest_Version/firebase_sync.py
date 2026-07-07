import os
import time
import shutil
import urllib.request
import firebase_admin
from firebase_admin import credentials, firestore

# Configuration Paths
DB_DIR = "/home/kevinvgu/Access-Control-System/database"
SERVICE_ACCOUNT_PATH = "/home/kevinvgu/Access-Control-System/serviceAccountKey.json"

def download_image(url, save_path):
    """Download biometric image from Storage / UploadThing to local directory"""
    try:
        # Emulate User-Agent to avoid download blocking
        opener = urllib.request.build_opener()
        opener.addheaders = [('User-agent', 'Mozilla/5.0')]
        urllib.request.install_opener(opener)
        
        urllib.request.urlretrieve(url, save_path)
        print(f"  [+] Downloaded image: {save_path}")
        return True
    except Exception as e:
        print(f"  [-] Error downloading image from {url}: {e}")
        return False

def sync_firestore():
    if not os.path.exists(SERVICE_ACCOUNT_PATH):
        print(f"\n[ERROR] Firebase configuration file not found at: {SERVICE_ACCOUNT_PATH}")
        print("Please download the Service Account Key (.json format) from Firebase Console:")
        print("Project Settings -> Service Accounts -> Generate New Private Key")
        print(f"And name it 'serviceAccountKey.json' in directory: /home/kevinvgu/Access-Control-System/\n")
        return

    # Initialize Firebase Admin SDK
    cred = credentials.Certificate(SERVICE_ACCOUNT_PATH)
    firebase_admin.initialize_app(cred)
    db = firestore.client()

    print("=========================================================")
    print(" STARTING CLOUD FIREBASE -> LOCAL DEVICE SYNC SERVICE")
    print("=========================================================")
    print(f"-> Listening for changes on Firestore '/users'...")
    print(f"-> Local storage directory: {DB_DIR}")
    print("---------------------------------------------------------")

    def on_snapshot(col_snapshot, changes, read_time):
        firestore_users = {}
        
        # Iterate over all active users in Firestore
        for doc in col_snapshot:
            data = doc.to_dict()
            status = data.get("status", "active")
            if status == "active":
                full_name = data.get("fullName")
                if full_name:
                    # Retrieve list of biometric images from subcollection 'faceImages'
                    images_ref = doc.reference.collection("faceImages")
                    image_docs = images_ref.stream()
                    urls = []
                    for img_doc in image_docs:
                        img_data = img_doc.to_dict()
                        url = img_data.get("storagePath")
                        if url:
                            urls.append(url)
                    firestore_users[full_name] = urls

        # Retrieve current list of local directories (excluding sqlite DB file)
        local_folders = [
            f for f in os.listdir(DB_DIR) 
            if os.path.isdir(os.path.join(DB_DIR, f)) and f != "smart_door.db"
        ]

        # 1. Delete folders of users deleted/disabled on Cloud
        for folder in local_folders:
            if folder not in firestore_users:
                print(f"[-] Detected access revocation: '{folder}'. Deleting local folder...")
                shutil.rmtree(os.path.join(DB_DIR, folder))

        # 2. Create folders and download images for new/updated users
        for name, urls in firestore_users.items():
            user_dir = os.path.join(DB_DIR, name)
            if not os.path.exists(user_dir):
                os.makedirs(user_dir)
                print(f"[+] Detected new registered user: '{name}'. Creating folder...")

            # Check and download any missing images locally
            for idx, url in enumerate(urls):
                ext = "png" if ".png" in url.lower() else "jpg"
                img_name = f"face_{idx}.{ext}"
                img_path = os.path.join(user_dir, img_name)

                if not os.path.exists(img_path):
                    print(f" -> Downloading biometric image {idx+1}/{len(urls)} for '{name}'...")
                    download_image(url, img_path)

    # Register real-time change listener
    users_query = db.collection("users")
    users_query.on_snapshot(on_snapshot)

    # Keep thread running indefinitely
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n-> Sync service stopped.")

if __name__ == "__main__":
    sync_firestore()
