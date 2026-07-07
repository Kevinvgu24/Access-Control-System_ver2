#include <iostream>
#include <string>
#include <vector>
#include <chrono>
#include <thread>
#include <cstdlib>
#include <cstring>
#include <sstream>
#include <fstream>
#include <sys/stat.h>
#include <sys/types.h>
#include <sqlite3.h>
#include <curl/curl.h>
#include <nlohmann/json.hpp>
#include <set>
#include <map>

using json = nlohmann::json;

// Global configuration variables loaded from Env
std::string SERVER_URL = "http://localhost:5000";
std::string LAB_ID = "default-lab";
std::string NODE_ID = "default-node";
std::string DB_PATH = "../../database/smart_door.db";
std::string DB_DIR = "../../database";

// Forward declarations
size_t WriteCallback(void* contents, size_t size, size_t nmemb, void* userp);
size_t WriteFileCallback(void* ptr, size_t size, size_t nmemb, FILE* stream);
std::string make_request(const std::string& url, const std::string& method, const std::string& post_data, bool& success);
bool download_file(const std::string& url, const std::string& save_path);
std::vector<uint8_t> pack_numpy_array(const std::vector<float>& vec);
std::vector<float> unpack_numpy_array(const void* blob_data, int blob_size);

// Create directory recursively (simple helper)
void create_directory(const std::string& path) {
#if defined(_WIN32)
    _mkdir(path.c_str());
#else
    mkdir(path.c_str(), 0777);
#endif
}

// Check if file exists
bool file_exists(const std::string& name) {
    struct stat buffer;   
    return (stat(name.c_str(), &buffer) == 0); 
}

// SQLite callbacks
int string_map_callback(void* data, int argc, char** argv, char** azColName) {
    auto* map = static_cast<std::map<std::string, json>*>(data);
    std::string name;
    json user_data = json::object();
    for (int i = 0; i < argc; i++) {
        std::string col = azColName[i];
        std::string val = argv[i] ? argv[i] : "";
        if (col == "name") {
            name = val;
        } else {
            user_data[col] = val;
        }
    }
    if (!name.empty()) {
        (*map)[name] = user_data;
    }
    return 0;
}

// Helper to check if database heartbeat timestamp is recent
bool is_timestamp_recent(const std::string& ts_str, double max_diff_seconds) {
    if (ts_str.empty()) return false;
    
    int year = 0, month = 0, day = 0, hour = 0, minute = 0, second = 0;
    std::string temp = ts_str;
    size_t t_pos = temp.find('T');
    if (t_pos != std::string::npos) {
        temp[t_pos] = ' ';
    }
    
    if (std::sscanf(temp.c_str(), "%d-%d-%d %d:%d:%d", &year, &month, &day, &hour, &minute, &second) < 6) {
        return false;
    }
    
    std::tm t = {};
    t.tm_year = year - 1900;
    t.tm_mon = month - 1;
    t.tm_mday = day;
    t.tm_hour = hour;
    t.tm_min = minute;
    t.tm_sec = second;
    t.tm_isdst = -1;
    
    std::time_t ts_time = std::mktime(&t);
    if (ts_time == -1) return false;
    
    std::time_t now_time = std::time(nullptr);
    double diff = std::difftime(now_time, ts_time);
    
    return (std::abs(diff) < max_diff_seconds);
}

// Sync utilities
void sync_telemetry() {
    sqlite3* db;
    if (sqlite3_open(DB_PATH.c_str(), &db) != SQLITE_OK) return;

    std::string sql = "SELECT latestTelemetry, status, onlineState, updatedAt FROM nodes WHERE id = '" + NODE_ID + "'";
    sqlite3_stmt* stmt;
    if (sqlite3_prepare_v2(db, sql.c_str(), -1, &stmt, nullptr) != SQLITE_OK) {
        sqlite3_close(db);
        return;
    }

    if (sqlite3_step(stmt) == SQLITE_ROW) {
        const unsigned char* telemetry_text = sqlite3_column_text(stmt, 0);
        const unsigned char* updated_at_text = sqlite3_column_text(stmt, 3);
        
        std::string telemetry_str = telemetry_text ? (char*)telemetry_text : "";
        std::string updated_at_str = updated_at_text ? (char*)updated_at_text : "";

        if (!telemetry_str.empty()) {
            try {
                json telemetry = json::parse(telemetry_str);
                
                // Determine online state based on last update timestamp (heartbeat < 5s)
                bool is_app_running = is_timestamp_recent(updated_at_str, 5.0);

                json payload = {
                    {"status", is_app_running ? "online" : "offline"},
                    {"onlineState", "online"},
                    {"cameraFps", is_app_running ? telemetry.value("cameraFps", 0.0) : 0.0},
                    {"cpuPercent", telemetry.value("cpuPercent", 0.0)},
                    {"ramPercent", telemetry.value("ramPercent", 0.0)},
                    {"temperatureC", telemetry.value("temperatureC", 0.0)}
                };

                std::string url = SERVER_URL + "/api/labs/" + LAB_ID + "/nodes/" + NODE_ID + "/telemetry";
                bool success = false;
                std::string res_str = make_request(url, "POST", payload.dump(), success);
                if (success) {
                    json res = json::parse(res_str);
                    bool request_ir = res.value("requestIrFrame", false);

                    // Write stream flag file
                    std::string flag_path = DB_DIR + "/../logs/ir_stream_active.txt";
                    create_directory(DB_DIR + "/../logs");
                    std::ofstream f(flag_path);
                    if (f.is_open()) {
                        f << (request_ir ? "1" : "0");
                        f.close();
                    }
                    std::cout << "[*] [TELEMETRY] Pushed successfully. IR stream flag: " << request_ir << std::endl;
                }
            } catch (const std::exception& e) {
                std::cerr << "[-] [TELEMETRY] Error: " << e.what() << std::endl;
            }
        }
    }
    sqlite3_finalize(stmt);
    sqlite3_close(db);
}

void sync_logs() {
    sqlite3* db;
    if (sqlite3_open(DB_PATH.c_str(), &db) != SQLITE_OK) return;

    // 1. Sync Access Events
    std::string sql_events = "SELECT id, labId, clusterId, nodeId, occurredAt, userId, universityId, displayName, method, result, reason, confidence, livenessScore, pinFallbackUsed FROM access_events WHERE synced = 0";
    sqlite3_stmt* stmt;
    if (sqlite3_prepare_v2(db, sql_events.c_str(), -1, &stmt, nullptr) == SQLITE_OK) {
        json events_arr = json::array();
        std::vector<int> event_ids;

        while (sqlite3_step(stmt) == SQLITE_ROW) {
            int id = sqlite3_column_int(stmt, 0);
            event_ids.push_back(id);

            json ev = {
                {"id", std::to_string(id)},
                {"labId", (char*)sqlite3_column_text(stmt, 1)},
                {"clusterId", (char*)sqlite3_column_text(stmt, 2)},
                {"nodeId", (char*)sqlite3_column_text(stmt, 3)},
                {"occurredAt", (char*)sqlite3_column_text(stmt, 4)},
                {"userId", sqlite3_column_text(stmt, 5) ? (char*)sqlite3_column_text(stmt, 5) : ""},
                {"universityId", sqlite3_column_text(stmt, 6) ? (char*)sqlite3_column_text(stmt, 6) : ""},
                {"displayName", sqlite3_column_text(stmt, 7) ? (char*)sqlite3_column_text(stmt, 7) : ""},
                {"method", (char*)sqlite3_column_text(stmt, 8)},
                {"result", (char*)sqlite3_column_text(stmt, 9)},
                {"reason", sqlite3_column_text(stmt, 10) ? (char*)sqlite3_column_text(stmt, 10) : ""},
                {"confidence", sqlite3_column_double(stmt, 11)},
                {"livenessScore", sqlite3_column_double(stmt, 12)},
                {"pinFallbackUsed", sqlite3_column_int(stmt, 13) != 0}
            };
            events_arr.push_back(ev);
        }
        sqlite3_finalize(stmt);

        if (!events_arr.empty()) {
            std::cout << "[*] [LOG SYNC] Pushing " << events_arr.size() << " unsynced access events..." << std::endl;
            std::string url = SERVER_URL + "/api/labs/" + LAB_ID + "/access-events";
            bool success = false;
            std::string res_str = make_request(url, "POST", events_arr.dump(), success);
            if (success) {
                // Mark as synced
                for (int id : event_ids) {
                    std::string up_sql = "UPDATE access_events SET synced = 1 WHERE id = " + std::to_string(id);
                    sqlite3_exec(db, up_sql.c_str(), nullptr, nullptr, nullptr);
                }
                std::cout << "  [+] Access events synced successfully." << std::endl;
            }
        }
    }

    // 2. Sync Incidents
    std::string sql_incidents = "SELECT id, labId, clusterId, nodeId, type, severity, status, summary, createdAt FROM incidents WHERE synced = 0";
    if (sqlite3_prepare_v2(db, sql_incidents.c_str(), -1, &stmt, nullptr) == SQLITE_OK) {
        json incidents_arr = json::array();
        std::vector<int> incident_ids;

        while (sqlite3_step(stmt) == SQLITE_ROW) {
            int id = sqlite3_column_int(stmt, 0);
            incident_ids.push_back(id);

            json inc = {
                {"id", id},
                {"labId", (char*)sqlite3_column_text(stmt, 1)},
                {"clusterId", (char*)sqlite3_column_text(stmt, 2)},
                {"nodeId", (char*)sqlite3_column_text(stmt, 3)},
                {"type", (char*)sqlite3_column_text(stmt, 4)},
                {"severity", (char*)sqlite3_column_text(stmt, 5)},
                {"status", (char*)sqlite3_column_text(stmt, 6)},
                {"summary", (char*)sqlite3_column_text(stmt, 7)},
                {"createdAt", (char*)sqlite3_column_text(stmt, 8)}
            };
            incidents_arr.push_back(inc);
        }
        sqlite3_finalize(stmt);

        if (!incidents_arr.empty()) {
            std::cout << "[*] [LOG SYNC] Pushing " << incidents_arr.size() << " unsynced incidents..." << std::endl;
            std::string url = SERVER_URL + "/api/labs/" + LAB_ID + "/incidents";
            bool success = false;
            std::string res_str = make_request(url, "POST", incidents_arr.dump(), success);
            if (success) {
                for (int id : incident_ids) {
                    std::string up_sql = "UPDATE incidents SET synced = 1 WHERE id = " + std::to_string(id);
                    sqlite3_exec(db, up_sql.c_str(), nullptr, nullptr, nullptr);
                }
                std::cout << "  [+] Incidents synced successfully." << std::endl;
            }
        }
    }

    sqlite3_close(db);
}

void sync_config() {
    bool success = false;
    std::string url = SERVER_URL + "/api/labs/" + LAB_ID + "/nodes/" + NODE_ID + "/config";
    std::string res_str = make_request(url, "GET", "", success);
    if (!success) return;

    try {
        json server_config = json::parse(res_str);
        int server_version = server_config.value("version", 1);

        sqlite3* db;
        if (sqlite3_open(DB_PATH.c_str(), &db) != SQLITE_OK) return;

        std::string sql = "SELECT version FROM node_config WHERE nodeId = '" + NODE_ID + "'";
        sqlite3_stmt* stmt;
        int local_version = 0;
        if (sqlite3_prepare_v2(db, sql.c_str(), -1, &stmt, nullptr) == SQLITE_OK) {
            if (sqlite3_step(stmt) == SQLITE_ROW) {
                local_version = sqlite3_column_int(stmt, 0);
            }
            sqlite3_finalize(stmt);
        }

        if (server_version > local_version) {
            std::cout << "[*] [CONFIG SYNC] Config outdated (" << local_version << " vs " << server_version << "). Applying update..." << std::endl;
            int confidence = server_config.value("confidenceThreshold", 90);
            int liveness = server_config.value("livenessThreshold", 78);
            int pin_fallback = server_config.value("pinFallbackEnabled", true) ? 1 : 0;
            int face_req = server_config.value("faceRequired", true) ? 1 : 0;
            int pin_req = server_config.value("pinRequired", true) ? 1 : 0;
            std::string updated_at = server_config.value("updatedAt", "");
            std::string updated_by = server_config.value("updatedBy", "server");

            std::string update_sql = "INSERT INTO node_config "
                                     "(nodeId, confidenceThreshold, livenessThreshold, pinFallbackEnabled, faceRequired, pinRequired, version, updatedAt, updatedBy) "
                                     "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) "
                                     "ON CONFLICT(nodeId) DO UPDATE SET "
                                     "confidenceThreshold = excluded.confidenceThreshold, "
                                     "livenessThreshold = excluded.livenessThreshold, "
                                     "pinFallbackEnabled = excluded.pinFallbackEnabled, "
                                     "faceRequired = excluded.faceRequired, "
                                     "pinRequired = excluded.pinRequired, "
                                     "version = excluded.version, "
                                     "updatedAt = excluded.updatedAt, "
                                     "updatedBy = excluded.updatedBy";
            
            sqlite3_stmt* up_stmt;
            if (sqlite3_prepare_v2(db, update_sql.c_str(), -1, &up_stmt, nullptr) == SQLITE_OK) {
                sqlite3_bind_text(up_stmt, 1, NODE_ID.c_str(), -1, SQLITE_TRANSIENT);
                sqlite3_bind_int(up_stmt, 2, confidence);
                sqlite3_bind_int(up_stmt, 3, liveness);
                sqlite3_bind_int(up_stmt, 4, pin_fallback);
                sqlite3_bind_int(up_stmt, 5, face_req);
                sqlite3_bind_int(up_stmt, 6, pin_req);
                sqlite3_bind_int(up_stmt, 7, server_version);
                sqlite3_bind_text(up_stmt, 8, updated_at.c_str(), -1, SQLITE_TRANSIENT);
                sqlite3_bind_text(up_stmt, 9, updated_by.c_str(), -1, SQLITE_TRANSIENT);
                
                if (sqlite3_step(up_stmt) == SQLITE_DONE) {
                    std::cout << "  [+] Config database row updated successfully." << std::endl;
                }
                sqlite3_finalize(up_stmt);
            }
        }
        sqlite3_close(db);
    } catch (...) {}
}

void sync_schedules() {
    bool success = false;
    std::string url = SERVER_URL + "/api/labs/" + LAB_ID + "/schedules";
    std::string res_str = make_request(url, "GET", "", success);
    if (!success) return;

    try {
        json server_scheds = json::parse(res_str);
        
        sqlite3* db;
        if (sqlite3_open(DB_PATH.c_str(), &db) != SQLITE_OK) return;

        // Start transaction for high-speed inserts
        sqlite3_exec(db, "BEGIN TRANSACTION;", nullptr, nullptr, nullptr);
        
        // Clear local schedules
        sqlite3_exec(db, "DELETE FROM lab_schedules;", nullptr, nullptr, nullptr);

        std::string ins_sql = "INSERT INTO lab_schedules (labId, student_id, student_name, group_nr, student_nr, date, day_of_week, ma, session_num, experiment, createdAt) "
                              "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))";
        sqlite3_stmt* ins_stmt;
        if (sqlite3_prepare_v2(db, ins_sql.c_str(), -1, &ins_stmt, nullptr) == SQLITE_OK) {
            for (const auto& s : server_scheds) {
                std::string student_id = s.value("student_id", "");
                std::string student_name = s.value("student_name", "");
                std::string group_nr = s.value("group_nr", "");
                std::string student_nr = s.value("student_nr", "");
                std::string date = s.value("date", "");
                std::string day_of_week = s.value("day_of_week", "");
                std::string ma = s.value("ma", "");
                std::string session_num = s.value("session_num", "");
                std::string experiment = s.value("experiment", "");

                sqlite3_bind_text(ins_stmt, 1, LAB_ID.c_str(), -1, SQLITE_TRANSIENT);
                sqlite3_bind_text(ins_stmt, 2, student_id.c_str(), -1, SQLITE_TRANSIENT);
                sqlite3_bind_text(ins_stmt, 3, student_name.c_str(), -1, SQLITE_TRANSIENT);
                sqlite3_bind_text(ins_stmt, 4, group_nr.c_str(), -1, SQLITE_TRANSIENT);
                sqlite3_bind_text(ins_stmt, 5, student_nr.c_str(), -1, SQLITE_TRANSIENT);
                sqlite3_bind_text(ins_stmt, 6, date.c_str(), -1, SQLITE_TRANSIENT);
                sqlite3_bind_text(ins_stmt, 7, day_of_week.c_str(), -1, SQLITE_TRANSIENT);
                sqlite3_bind_text(ins_stmt, 8, ma.c_str(), -1, SQLITE_TRANSIENT);
                sqlite3_bind_text(ins_stmt, 9, session_num.c_str(), -1, SQLITE_TRANSIENT);
                sqlite3_bind_text(ins_stmt, 10, experiment.c_str(), -1, SQLITE_TRANSIENT);

                sqlite3_step(ins_stmt);
                sqlite3_reset(ins_stmt);
            }
            sqlite3_finalize(ins_stmt);
        }

        sqlite3_exec(db, "COMMIT;", nullptr, nullptr, nullptr);
        sqlite3_close(db);
        std::cout << "[+] [SCHEDULE SYNC] Synced " << server_scheds.size() << " schedules to edge database." << std::endl;
    } catch (...) {}
}

void sync_users() {
    bool success = false;
    std::string url = SERVER_URL + "/api/labs/" + LAB_ID + "/users";
    std::string res_str = make_request(url, "GET", "", success);
    if (!success) return;

    try {
        json server_users = json::parse(res_str);
        
        sqlite3* db;
        if (sqlite3_open(DB_PATH.c_str(), &db) != SQLITE_OK) return;

        // Load local users
        std::map<std::string, json> local_users;
        std::string local_sql = "SELECT name, university_id, email, role, status, pin FROM users";
        sqlite3_exec(db, local_sql.c_str(), string_map_callback, &local_users, nullptr);

        std::set<std::string> active_server_names;

        for (const auto& user : server_users) {
            std::string name = user.value("fullName", "");
            std::string university_id = user.value("university_id", "");
            std::string email = user.value("email", "");
            std::string role = user.contains("roles") && !user["roles"].empty() ? user["roles"][0].get<std::string>() : "student";
            std::string status = user.value("status", "");
            std::string pin = user.value("pin", "");

            if (status != "active") continue;
            active_server_names.insert(name);

            std::string user_dir = DB_DIR + "/" + name;

            // Scenario A: User is completely new to this edge node
            if (local_users.find(name) == local_users.end()) {
                std::cout << "[+] [USER SYNC] New user detected: '" << name << "'. Syncing profile..." << std::endl;
                create_directory(user_dir);

                // Check if embedding exists on server
                bool emb_success = false;
                std::string emb_res = make_request(SERVER_URL + "/api/users/" + name + "/embedding", "GET", "", emb_success);
                
                if (emb_success) {
                    json emb_json = json::parse(emb_res);
                    std::vector<float> emb = emb_json["embedding"].get<std::vector<float>>();
                    std::vector<uint8_t> packed_emb = pack_numpy_array(emb);

                    std::string ins_sql = "INSERT INTO users (name, university_id, email, password, role, status, pinStatus, pin, embedding, createdAt) "
                                          "VALUES (?, ?, ?, '', ?, ?, 'active', ?, ?, datetime('now'))";
                    sqlite3_stmt* ins_stmt;
                    if (sqlite3_prepare_v2(db, ins_sql.c_str(), -1, &ins_stmt, nullptr) == SQLITE_OK) {
                        sqlite3_bind_text(ins_stmt, 1, name.c_str(), -1, SQLITE_TRANSIENT);
                        sqlite3_bind_text(ins_stmt, 2, university_id.c_str(), -1, SQLITE_TRANSIENT);
                        sqlite3_bind_text(ins_stmt, 3, email.c_str(), -1, SQLITE_TRANSIENT);
                        sqlite3_bind_text(ins_stmt, 4, role.c_str(), -1, SQLITE_TRANSIENT);
                        sqlite3_bind_text(ins_stmt, 5, status.c_str(), -1, SQLITE_TRANSIENT);
                        sqlite3_bind_text(ins_stmt, 6, pin.c_str(), -1, SQLITE_TRANSIENT);
                        sqlite3_bind_blob(ins_stmt, 7, packed_emb.data(), packed_emb.size(), SQLITE_TRANSIENT);

                        if (sqlite3_step(ins_stmt) == SQLITE_DONE) {
                            std::cout << "  [+] Saved pre-computed embedding from server for '" << name << "'." << std::endl;
                        }
                        sqlite3_finalize(ins_stmt);
                    }
                } else {
                    // Download raw photos for local NPU processing
                    bool photo_list_success = false;
                    std::string photo_list_res = make_request(SERVER_URL + "/api/users/" + name + "/photos", "GET", "", photo_list_success);
                    if (photo_list_success) {
                        json photos = json::parse(photo_list_res);
                        for (const auto& photo : photos) {
                            std::string photo_name = photo.get<std::string>();
                            std::string save_path = user_dir + "/" + photo_name;
                            if (!file_exists(save_path)) {
                                std::cout << "  -> Downloading biometric photo: " << photo_name << "..." << std::endl;
                                download_file(SERVER_URL + "/api/users/" + name + "/photos/" + photo_name, save_path);
                            }
                        }
                    }
                    // Insert into DB with NULL embedding (triggers auto-sync NPU watcher)
                    std::string ins_sql = "INSERT INTO users (name, university_id, email, password, role, status, pinStatus, pin, embedding, createdAt) "
                                          "VALUES (?, ?, ?, '', ?, ?, 'active', ?, NULL, datetime('now'))";
                    sqlite3_stmt* ins_stmt;
                    if (sqlite3_prepare_v2(db, ins_sql.c_str(), -1, &ins_stmt, nullptr) == SQLITE_OK) {
                        sqlite3_bind_text(ins_stmt, 1, name.c_str(), -1, SQLITE_TRANSIENT);
                        sqlite3_bind_text(ins_stmt, 2, university_id.c_str(), -1, SQLITE_TRANSIENT);
                        sqlite3_bind_text(ins_stmt, 3, email.c_str(), -1, SQLITE_TRANSIENT);
                        sqlite3_bind_text(ins_stmt, 4, role.c_str(), -1, SQLITE_TRANSIENT);
                        sqlite3_bind_text(ins_stmt, 5, status.c_str(), -1, SQLITE_TRANSIENT);
                        sqlite3_bind_text(ins_stmt, 6, pin.c_str(), -1, SQLITE_TRANSIENT);

                        if (sqlite3_step(ins_stmt) == SQLITE_DONE) {
                            std::cout << "  [+] Profile & photo cache downloaded. Queued for offline C++ enrollment." << std::endl;
                        }
                        sqlite3_finalize(ins_stmt);
                    }
                }
            } else {
                // Scenario B: User exists locally. Upload embedding if missing on server
                // Query embedding
                std::string sel_emb = "SELECT embedding FROM users WHERE name = ?";
                sqlite3_stmt* sel_stmt;
                if (sqlite3_prepare_v2(db, sel_emb.c_str(), -1, &sel_stmt, nullptr) == SQLITE_OK) {
                    sqlite3_bind_text(sel_stmt, 1, name.c_str(), -1, SQLITE_TRANSIENT);
                    if (sqlite3_step(sel_stmt) == SQLITE_ROW) {
                        const void* blob = sqlite3_column_blob(sel_stmt, 0);
                        int bytes = sqlite3_column_bytes(sel_stmt, 0);
                        if (blob && bytes > 2048) {
                            if (user.value("faceStatus", "") != "complete") {
                                std::cout << "[*] [EMBEDDING SYNC] Server is missing embedding for '" << name << "'. Uploading..." << std::endl;
                                std::vector<float> raw_emb = unpack_numpy_array(blob, bytes);
                                json up_payload = {{"embedding", raw_emb}};
                                bool up_ok = false;
                                make_request(SERVER_URL + "/api/users/" + name + "/embedding", "POST", up_payload.dump(), up_ok);
                                if (up_ok) {
                                    std::cout << "  [+] Uploaded embedding successfully." << std::endl;
                                }
                            }
                        }
                    }
                    sqlite3_finalize(sel_stmt);
                }

                // Update local profile fields (PIN, role, status) if changed
                std::string up_fields = "UPDATE users SET university_id = ?, email = ?, role = ?, status = ?, pin = ? WHERE name = ?";
                sqlite3_stmt* up_stmt;
                if (sqlite3_prepare_v2(db, up_fields.c_str(), -1, &up_stmt, nullptr) == SQLITE_OK) {
                    sqlite3_bind_text(up_stmt, 1, university_id.c_str(), -1, SQLITE_TRANSIENT);
                    sqlite3_bind_text(up_stmt, 2, email.c_str(), -1, SQLITE_TRANSIENT);
                    sqlite3_bind_text(up_stmt, 3, role.c_str(), -1, SQLITE_TRANSIENT);
                    sqlite3_bind_text(up_stmt, 4, status.c_str(), -1, SQLITE_TRANSIENT);
                    sqlite3_bind_text(up_stmt, 5, pin.c_str(), -1, SQLITE_TRANSIENT);
                    sqlite3_bind_text(up_stmt, 6, name.c_str(), -1, SQLITE_TRANSIENT);
                    sqlite3_step(up_stmt);
                    sqlite3_finalize(up_stmt);
                }
            }
        }

        // Clean up deleted/revoked users
        for (const auto& pair : local_users) {
            std::string local_name = pair.first;
            if (active_server_names.find(local_name) == active_server_names.end()) {
                std::cout << "[-] [USER SYNC] Purging local cache for revoked user '" << local_name << "'..." << std::endl;
                std::string del_sql = "DELETE FROM users WHERE name = ?";
                sqlite3_stmt* del_stmt;
                if (sqlite3_prepare_v2(db, del_sql.c_str(), -1, &del_stmt, nullptr) == SQLITE_OK) {
                    sqlite3_bind_text(del_stmt, 1, local_name.c_str(), -1, SQLITE_TRANSIENT);
                    sqlite3_step(del_stmt);
                    sqlite3_finalize(del_stmt);
                }
                // Delete user photos folder recursively
                std::string rmdir_cmd = "rm -rf \"" + DB_DIR + "/" + local_name + "\"";
                int status = std::system(rmdir_cmd.c_str());
                (void)status;
            }
        }

        sqlite3_close(db);
    } catch (...) {}
}

int main() {
    // Load config from environment variables
    const char* env_server = std::getenv("SERVER_URL");
    const char* env_lab = std::getenv("LAB_ID");
    const char* env_node = std::getenv("NODE_ID");
    const char* env_db = std::getenv("DB_PATH");

    if (env_server) SERVER_URL = env_server;
    if (env_lab) LAB_ID = env_lab;
    if (env_node) NODE_ID = env_node;
    if (env_db) {
        DB_PATH = env_db;
        // extract folder
        size_t last_slash = DB_PATH.find_last_of("/\\");
        if (last_slash != std::string::npos) {
            DB_DIR = DB_PATH.substr(0, last_slash);
        }
    }

    std::cout << "=========================================================\n"
              << "   STARTING EDGE NODE -> CENTRAL SERVER C++ SYNC CLIENT  \n"
              << "Server URL:   " << SERVER_URL << "\n"
              << "Lab ID:       " << LAB_ID << "\n"
              << "Node ID:      " << NODE_ID << "\n"
              << "Database:     " << DB_PATH << "\n"
              << "=========================================================\n" << std::endl;

    curl_global_init(CURL_GLOBAL_DEFAULT);

    auto last_telemetry_time = std::chrono::steady_clock::now();
    auto last_logs_time = std::chrono::steady_clock::now();
    auto last_users_config_time = std::chrono::steady_clock::now();

    while (true) {
        auto now = std::chrono::steady_clock::now();

        // 1. Sync Telemetry: every 2 seconds
        if (std::chrono::duration_cast<std::chrono::seconds>(now - last_telemetry_time).count() >= 2) {
            sync_telemetry();
            last_telemetry_time = std::chrono::steady_clock::now();
        }

        // 2. Sync Logs & Incidents: every 4 seconds
        if (std::chrono::duration_cast<std::chrono::seconds>(now - last_logs_time).count() >= 4) {
            sync_logs();
            last_logs_time = std::chrono::steady_clock::now();
        }

        // 3. Pull Users & Config: every 15 seconds
        if (std::chrono::duration_cast<std::chrono::seconds>(now - last_users_config_time).count() >= 15) {
            sync_config();
            sync_users();
            sync_schedules();
            last_users_config_time = std::chrono::steady_clock::now();
        }

        std::this_thread::sleep_for(std::chrono::milliseconds(200));
    }

    curl_global_cleanup();
    return 0;
}

// CURL wrappers
size_t WriteCallback(void* contents, size_t size, size_t nmemb, void* userp) {
    ((std::string*)userp)->append((char*)contents, size * nmemb);
    return size * nmemb;
}

size_t WriteFileCallback(void* ptr, size_t size, size_t nmemb, FILE* stream) {
    size_t written = fwrite(ptr, size, nmemb, stream);
    return written;
}

std::string make_request(const std::string& url, const std::string& method, const std::string& post_data, bool& success) {
    CURL* curl = curl_easy_init();
    std::string readBuffer;
    success = false;

    if (curl) {
        struct curl_slist* headers = nullptr;
        headers = curl_slist_append(headers, "User-Agent: Mozilla/5.0");
        
        curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
        curl_easy_setopt(curl, CURLOPT_TIMEOUT, 5L);

        if (method == "POST") {
            headers = curl_slist_append(headers, "Content-Type: application/json");
            curl_easy_setopt(curl, CURLOPT_POSTFIELDS, post_data.c_str());
        } else if (method == "DELETE") {
            curl_easy_setopt(curl, CURLOPT_CUSTOMREQUEST, "DELETE");
        }

        curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
        curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, WriteCallback);
        curl_easy_setopt(curl, CURLOPT_WRITEDATA, &readBuffer);

        CURLcode res = curl_easy_perform(curl);
        if (res == CURLE_OK) {
            long response_code;
            curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &response_code);
            if (response_code >= 200 && response_code < 300) {
                success = true;
            }
        }
        curl_slist_free_all(headers);
        curl_easy_cleanup(curl);
    }
    return readBuffer;
}

bool download_file(const std::string& url, const std::string& save_path) {
    CURL* curl = curl_easy_init();
    FILE* fp = fopen(save_path.c_str(), "wb");
    bool success = false;

    if (curl && fp) {
        curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
        curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, WriteFileCallback);
        curl_easy_setopt(curl, CURLOPT_WRITEDATA, fp);
        curl_easy_setopt(curl, CURLOPT_TIMEOUT, 10L);
        curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);

        CURLcode res = curl_easy_perform(curl);
        if (res == CURLE_OK) {
            long response_code;
            curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &response_code);
            if (response_code >= 200 && response_code < 300) {
                success = true;
            }
        }
        curl_easy_cleanup(curl);
    }
    if (fp) fclose(fp);
    return success;
}

// Pack vector into NumPy .npy format (512 floats)
std::vector<uint8_t> pack_numpy_array(const std::vector<float>& vec) {
    std::string header = "{'descr': '<f4', 'fortran_order': False, 'shape': (512,), }";
    while (header.length() < 117) {
        header += " ";
    }
    header += "\n";
    
    std::vector<uint8_t> blob(128 + 512 * sizeof(float));
    blob[0] = 0x93;
    blob[1] = 'N';
    blob[2] = 'U';
    blob[3] = 'M';
    blob[4] = 'P';
    blob[5] = 'Y';
    blob[6] = 0x01;
    blob[7] = 0x00;
    
    uint16_t header_len = header.length();
    blob[8] = header_len & 0xFF;
    blob[9] = (header_len >> 8) & 0xFF;
    
    std::memcpy(&blob[10], header.data(), header.length());
    std::memcpy(&blob[128], vec.data(), 512 * sizeof(float));
    
    return blob;
}

// Unpack vector from NumPy .npy format (512 floats)
std::vector<float> unpack_numpy_array(const void* blob_data, int blob_size) {
    if (blob_size < 2048) return {};
    std::vector<float> vec(512);
    std::memcpy(vec.data(), (const char*)blob_data + (blob_size - 2048), 2048);
    return vec;
}
