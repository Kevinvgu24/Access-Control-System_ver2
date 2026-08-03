#include <iostream>
#include <vector>
#include <random>
#include <chrono>
#include <cmath>
#include <algorithm>
#include <fstream>
#include <iomanip>

// Biểu diễn vector 512 chiều chuẩn ArcFace
const int EMBEDDING_DIM = 512;

struct UserEmbedding {
    std::string name;
    std::vector<float> embedding;
};

// Hàm tạo vector ngẫu nhiên được chuẩn hóa (unit length L2)
std::vector<float> generate_normalized_vector(std::mt19937 &gen) {
    std::normal_distribution<float> dist(0.0f, 1.0f);
    std::vector<float> vec(EMBEDDING_DIM);
    float norm = 0.0f;
    for (int i = 0; i < EMBEDDING_DIM; ++i) {
        vec[i] = dist(gen);
        norm += vec[i] * vec[i];
    }
    norm = std::sqrt(norm);
    if (norm > 0.0f) {
        for (int i = 0; i < EMBEDDING_DIM; ++i) {
            vec[i] /= norm;
        }
    }
    return vec;
}

// Hàm đo Cosine Similarity (Dot Product với vector đã chuẩn hóa)
inline float cosine_similarity(const float* a, const float* b) {
    float dot = 0.0f;
    for (int i = 0; i < EMBEDDING_DIM; ++i) {
        dot += a[i] * b[i];
    }
    return dot;
}

void run_vector_search_benchmark(int num_users, int num_queries, std::ofstream &json_out, bool is_last) {
    std::mt19937 gen(42); // Seed cố định để kết quả có thể tái lập (reproducible)
    
    // Khởi tạo cơ sở dữ liệu giả lập với N người dùng
    std::vector<UserEmbedding> db_users;
    db_users.reserve(num_users);
    for (int i = 0; i < num_users; ++i) {
        db_users.push_back({"User_" + std::to_string(i), generate_normalized_vector(gen)});
    }
    
    // Khởi tạo danh sách các vector truy vấn
    std::vector<std::vector<float>> queries;
    queries.reserve(num_queries);
    for (int i = 0; i < num_queries; ++i) {
        queries.push_back(generate_normalized_vector(gen));
    }
    
    // Đo thời gian thực hiện num_queries lượt tìm kiếm 1:N
    std::vector<double> latencies_us;
    latencies_us.reserve(num_queries);
    
    auto total_start = std::chrono::high_resolution_clock::now();
    
    for (int q = 0; q < num_queries; ++q) {
        const float* query_ptr = queries[q].data();
        auto q_start = std::chrono::high_resolution_clock::now();
        
        float best_sim = -1.0f;
        int best_idx = -1;
        
        for (int u = 0; u < num_users; ++u) {
            float sim = cosine_similarity(query_ptr, db_users[u].embedding.data());
            if (sim > best_sim) {
                best_sim = sim;
                best_idx = u;
            }
        }
        
        auto q_end = std::chrono::high_resolution_clock::now();
        double latency_us = std::chrono::duration<double, std::micro>(q_end - q_start).count();
        latencies_us.push_back(latency_us);
    }
    
    auto total_end = std::chrono::high_resolution_clock::now();
    double total_time_ms = std::chrono::duration<double, std::milli>(total_end - total_start).count();
    
    // Tính toán chỉ số thống kê
    std::sort(latencies_us.begin(), latencies_us.end());
    double sum_us = 0.0;
    for (double lat : latencies_us) sum_us += lat;
    
    double mean_us = sum_us / num_queries;
    double p50_us = latencies_us[static_cast<size_t>(num_queries * 0.50)];
    double p95_us = latencies_us[static_cast<size_t>(num_queries * 0.95)];
    double p99_us = latencies_us[static_cast<size_t>(num_queries * 0.99)];
    double qps = (num_queries / total_time_ms) * 1000.0;
    double mem_mb = (num_users * EMBEDDING_DIM * sizeof(float)) / (1024.0 * 1024.0);

    std::cout << "--------------------------------------------------------\n";
    std::cout << " [N = " << num_users << " users] Benchmark Results:\n";
    std::cout << "  - Memory Size    : " << std::fixed << std::setprecision(2) << mem_mb << " MB\n";
    std::cout << "  - Total Time     : " << std::setprecision(2) << total_time_ms << " ms for " << num_queries << " queries\n";
    std::cout << "  - Throughput (QPS): " << std::setprecision(1) << qps << " queries/sec\n";
    std::cout << "  - Mean Latency   : " << std::setprecision(2) << mean_us << " us (" << mean_us / 1000.0 << " ms)\n";
    std::cout << "  - P50 Latency    : " << std::setprecision(2) << p50_us << " us\n";
    std::cout << "  - P95 Latency    : " << std::setprecision(2) << p95_us << " us\n";
    std::cout << "  - P99 Latency    : " << std::setprecision(2) << p99_us << " us\n";

    json_out << "    {\n";
    json_out << "      \"num_users\": " << num_users << ",\n";
    json_out << "      \"num_queries\": " << num_queries << ",\n";
    json_out << "      \"memory_mb\": " << mem_mb << ",\n";
    json_out << "      \"total_time_ms\": " << total_time_ms << ",\n";
    json_out << "      \"qps\": " << qps << ",\n";
    json_out << "      \"mean_latency_us\": " << mean_us << ",\n";
    json_out << "      \"p50_latency_us\": " << p50_us << ",\n";
    json_out << "      \"p95_latency_us\": " << p95_us << ",\n";
    json_out << "      \"p99_latency_us\": " << p99_us << "\n";
    json_out << "    }" << (is_last ? "" : ",") << "\n";
}

int main() {
    std::cout << "========================================================\n";
    std::cout << " C++ Vector Search Benchmark (512-D Cosine Similarity)\n";
    std::cout << "========================================================\n\n";
    
    std::ofstream json_file("benchmark_vector_results.json");
    json_file << "{\n  \"results\": [\n";
    
    std::vector<int> user_scales = {100, 500, 1000, 5000, 10000, 50000};
    int num_queries = 2000;
    
    for (size_t i = 0; i < user_scales.size(); ++i) {
        bool is_last = (i == user_scales.size() - 1);
        run_vector_search_benchmark(user_scales[i], num_queries, json_file, is_last);
    }
    
    json_file << "  ]\n}\n";
    json_file.close();
    
    std::cout << "\nResults saved to benchmark_vector_results.json\n";
    return 0;
}
