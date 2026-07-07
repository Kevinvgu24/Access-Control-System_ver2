#include <iostream>
#include <string>
#include <vector>
#include <chrono>
#include <thread>
#include <cstdlib>
#include <cstring>
#include <sys/inotify.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>
#include <sqlite3.h>

#define EVENT_SIZE  (sizeof(struct inotify_event))
#define BUF_LEN     (1024 * (EVENT_SIZE + 16))

// Defaults that can be overridden via Env
std::string YOLO_HEF = "/home/kevinvgu/Access-Control-System_ver2/resources/yolov8s_face.hef";
std::string ARCFACE_HEF = "/home/kevinvgu/Access-Control-System_ver2/resources/arcface_mobilefacenet.hef";
std::string LBF_MODEL = "/home/kevinvgu/Access-Control-System_ver2/src/lbfmodel.yaml";
std::string DB_DIR = "/home/kevinvgu/Access-Control-System_ver2/database";
std::string DB_PATH = "/home/kevinvgu/Access-Control-System_ver2/database/smart_door.db";
std::string REGISTER_SCRIPT = "/home/kevinvgu/Access-Control-System_ver2/src/Newest_Version/register.py";

void handle_directory_deletion(const std::string& name) {
    std::cout << "[*] [WATCHER] Directory for user '" << name << "' was removed. Revoking access..." << std::endl;
    
    sqlite3* db;
    if (sqlite3_open(DB_PATH.c_str(), &db) == SQLITE_OK) {
        std::string sql = "DELETE FROM users WHERE name = ?";
        sqlite3_stmt* stmt;
        if (sqlite3_prepare_v2(db, sql.c_str(), -1, &stmt, nullptr) == SQLITE_OK) {
            sqlite3_bind_text(stmt, 1, name.c_str(), -1, SQLITE_TRANSIENT);
            if (sqlite3_step(stmt) == SQLITE_DONE) {
                std::cout << "  [+] Removed '" << name << "' from local SQLite database." << std::endl;
            }
            sqlite3_finalize(stmt);
        }
        sqlite3_close(db);
    }
}

void handle_directory_creation(const std::string& name) {
    std::cout << "[*] [WATCHER] New directory for user '" << name << "' detected." << std::endl;
    std::cout << "  -> Waiting 3 seconds for photo transfers to complete..." << std::endl;
    
    // Give some time for file writes to finish (e.g. if files are being copied/downloaded)
    std::this_thread::sleep_for(std::chrono::seconds(3));
    
    std::cout << "  -> Spawning enrollment subprocess..." << std::endl;
    
    // Execute python register.py script to handle NPU inference and SQLite update
    std::string cmd = "python3 " + REGISTER_SCRIPT + 
                      " --yolo_hef " + YOLO_HEF + 
                      " --arcface_hef " + ARCFACE_HEF + 
                      " --db_dir " + DB_DIR + 
                      " --lbf_model " + LBF_MODEL;
                      
    std::cout << "  [CMD]: " << cmd << std::endl;
    int status = std::system(cmd.c_str());
    if (status == 0) {
        std::cout << "  [+] Enrollment process for '" << name << "' completed successfully." << std::endl;
    } else {
        std::cerr << "  [-] Enrollment subprocess returned non-zero status: " << status << std::endl;
    }
}

int main() {
    // Read Env overrides
    const char* env_yolo = std::getenv("YOLO_HEF");
    const char* env_arc = std::getenv("ARCFACE_HEF");
    const char* env_lbf = std::getenv("LBF_MODEL");
    const char* env_db_dir = std::getenv("DB_DIR");
    const char* env_db_path = std::getenv("DB_PATH");
    const char* env_reg = std::getenv("REGISTER_SCRIPT");

    if (env_yolo) YOLO_HEF = env_yolo;
    if (env_arc) ARCFACE_HEF = env_arc;
    if (env_lbf) LBF_MODEL = env_lbf;
    if (env_db_dir) DB_DIR = env_db_dir;
    if (env_db_path) DB_PATH = env_db_path;
    if (env_reg) REGISTER_SCRIPT = env_reg;

    std::cout << "=========================================================\n"
              << "   STARTING INOTIFY C++ DATABASE DIRECTORY WATCHER DEEMON \n"
              << "Watching directory: " << DB_DIR << "\n"
              << "SQLite Database:    " << DB_PATH << "\n"
              << "YOLO model:         " << YOLO_HEF << "\n"
              << "ArcFace model:      " << ARCFACE_HEF << "\n"
              << "=========================================================\n" << std::endl;

    int fd = inotify_init();
    if (fd < 0) {
        std::cerr << "[-] Failed to initialize inotify" << std::endl;
        return 1;
    }

    // Watch for directory creations and deletions inside the database dir
    int wd = inotify_add_watch(fd, DB_DIR.c_str(), IN_CREATE | IN_DELETE);
    if (wd < 0) {
        std::cerr << "[-] Failed to add watch on " << DB_DIR << std::endl;
        close(fd);
        return 1;
    }

    char buffer[BUF_LEN];
    while (true) {
        int length = read(fd, buffer, BUF_LEN);
        if (length < 0) {
            std::cerr << "[-] Error reading inotify events" << std::endl;
            break;
        }

        int i = 0;
        while (i < length) {
            struct inotify_event* event = (struct inotify_event*)&buffer[i];
            if (event->len) {
                // We only care about folder changes, skip hidden files or specific extensions
                if (event->mask & IN_ISDIR) {
                    std::string dir_name(event->name);
                    // Filter out current/parent directories or temp folders
                    if (dir_name != "." && dir_name != ".." && dir_name != "temp") {
                        if (event->mask & IN_CREATE) {
                            handle_directory_creation(dir_name);
                        } else if (event->mask & IN_DELETE) {
                            handle_directory_deletion(dir_name);
                        }
                    }
                }
            }
            i += EVENT_SIZE + event->len;
        }
    }

    inotify_rm_watch(fd, wd);
    close(fd);
    return 0;
}
