cmake_minimum_required(VERSION 3.10)
project(smart_door_cpp)

set(CMAKE_CXX_STANDARD 14)
# Remove -shared from global flags so executables compile correctly.
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -O3 -fPIC -Wall")

# Tìm các dependencies cho GStreamer 1.0
find_package(PkgConfig REQUIRED)
pkg_check_modules(GST REQUIRED gstreamer-1.0)
pkg_check_modules(GST_VIDEO REQUIRED gstreamer-video-1.0)

# Tìm OpenCV (core + imgproc + calib3d)
find_package(OpenCV REQUIRED COMPONENTS core imgproc calib3d)

# Tìm CURL cho sync client
find_package(CURL REQUIRED)

# Khai báo include directories cho SDK TAPPAS, GStreamer, OpenCV & CURL
include_directories(
    /usr/include/hailo
    /usr/include/hailo/tappas
    ${GST_INCLUDE_DIRS}
    ${GST_VIDEO_INCLUDE_DIRS}
    ${OpenCV_INCLUDE_DIRS}
    ${CURL_INCLUDE_DIRS}
)

# ── 1. THƯ VIỆN ĐỘNG (GSTREAMER PLUGINS) ──────────────────────────────────────

add_library(yolo26_landmark_post SHARED yolo26_landmark_post.cpp)
add_library(arcface_post SHARED arcface_post.cpp)
add_library(db_matcher_post SHARED db_matcher_post.cpp)
add_library(face_align SHARED face_align.cpp)

# Link thư viện GStreamer
target_link_libraries(yolo26_landmark_post
    ${GST_LIBRARIES}
)
target_link_libraries(arcface_post
    ${GST_LIBRARIES}
)
target_link_libraries(db_matcher_post
    ${GST_LIBRARIES}
)

# Link OpenCV + GStreamer-video cho face_align
target_link_libraries(face_align
    ${GST_LIBRARIES}
    ${GST_VIDEO_LIBRARIES}
    ${OpenCV_LIBS}
    /usr/lib/aarch64-linux-gnu/libgsthailometa.so
)

# C++ Anti-Spoofing Shared Library for Python ctypes integration
add_library(anti_spoofing SHARED anti_spoofing.cpp)
target_link_libraries(anti_spoofing
    ${OpenCV_LIBS}
)

# ── 2. FILE THỰC THI (BACKGROUND SERVICES) ───────────────────────────────────

# Dịch vụ đồng bộ dữ liệu Edge Node -> Central Server
add_executable(local_sync_client local_sync_client.cpp)
target_link_libraries(local_sync_client
    ${CURL_LIBRARIES}
    sqlite3
)

# Dịch vụ theo dõi thư mục ảnh và đồng bộ SQLite
add_executable(auto_sync_watcher auto_sync_watcher.cpp)
target_link_libraries(auto_sync_watcher
    sqlite3
)
