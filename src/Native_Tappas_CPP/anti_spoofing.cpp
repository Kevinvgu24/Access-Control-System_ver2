#include <opencv2/opencv.hpp>
#include <iostream>
#include <vector>
#include <cmath>
#include <algorithm>
#include <cstring>
#include <cstdio>

extern "C" {
    struct LivenessResult {
        bool is_live;
        float score;
        char reason[128];
    };

    LivenessResult check_liveness_cpp(
        const uint8_t* img_data, int width, int height, int step,
        const float* landmarks, int num_landmarks,
        float min_contrast_ratio, float min_blur_var, float max_blur_var,
        float max_hotspot_ratio, float min_radial_ratio
    ) {
        LivenessResult res = {false, 0.0f, ""};

        if (!img_data || width <= 0 || height <= 0) {
            res.is_live = false;
            res.score = 0.0f;
            std::strncpy(res.reason, "Empty crop", sizeof(res.reason));
            return res;
        }

        // Wrap input buffer in OpenCV Mat
        cv::Mat ir_face_crop(height, width, CV_8UC1, const_cast<uint8_t*>(img_data), step);

        int total_pixels = width * height;

        // 1. Mean Brightness (Smartphone Screen Check)
        cv::Scalar mean_brightness_val = cv::mean(ir_face_crop);
        double mean_brightness = mean_brightness_val[0];
        if (mean_brightness < 35.0) {
            res.is_live = false;
            res.score = (float)mean_brightness;
            std::snprintf(res.reason, sizeof(res.reason), "Crop too dark/IR absorption (brightness: %.1f)", mean_brightness);
            return res;
        }

        // 2. Specular Hotspot Glare
        int hotspot_threshold = std::max(240, std::min(254, static_cast<int>(mean_brightness + 40)));
        cv::Mat hotspot_mask;
        cv::threshold(ir_face_crop, hotspot_mask, hotspot_threshold, 255, cv::THRESH_BINARY);
        int hotspot_pixels = cv::countNonZero(hotspot_mask);
        float hotspot_ratio = (float)hotspot_pixels / total_pixels;

        // 3. 3D Radial Shading
        int inner_h_start = static_cast<int>(height * 0.25);
        int inner_h_end = static_cast<int>(height * 0.75);
        int inner_w_start = static_cast<int>(width * 0.25);
        int inner_w_end = static_cast<int>(width * 0.75);
        cv::Mat inner_zone = ir_face_crop(cv::Range(inner_h_start, inner_h_end), cv::Range(inner_w_start, inner_w_end));
        
        cv::Mat outer_mask = cv::Mat::ones(height, width, CV_8UC1);
        int outer_h_start = static_cast<int>(height * 0.15);
        int outer_h_end = static_cast<int>(height * 0.85);
        int outer_w_start = static_cast<int>(width * 0.15);
        int outer_w_end = static_cast<int>(width * 0.85);
        outer_mask(cv::Range(outer_h_start, outer_h_end), cv::Range(outer_w_start, outer_w_end)).setTo(0);

        cv::Scalar mean_inner_val = cv::mean(inner_zone);
        cv::Scalar mean_outer_val = cv::mean(ir_face_crop, outer_mask);
        double mean_inner = mean_inner_val[0];
        double mean_outer = mean_outer_val[0];
        float radial_ratio = (float)(mean_inner / (mean_outer > 0 ? mean_outer : 1.0));

        // 4. Biological Contrast (Attention ROI)
        double mean_eye = 1.0;
        double mean_skin = 1.0;

        if (landmarks && num_landmarks >= 5) {
            try {
                // Get landmark coordinates (landmarks is float array: x1, y1, x2, y2, ...)
                int lex = static_cast<int>(landmarks[0] * width);
                int ley = static_cast<int>(landmarks[1] * height);
                int rex = static_cast<int>(landmarks[2] * width);
                int rey = static_cast<int>(landmarks[3] * height);
                int mx = static_cast<int>(landmarks[4] * width);  // Nose x
                int my = static_cast<int>(landmarks[5] * height); // Nose y

                int eye_sz = static_cast<int>(width * 0.12);
                int skin_sz = static_cast<int>(width * 0.15);

                cv::Rect left_eye_rect(std::max(0, lex-eye_sz), std::max(0, ley-eye_sz), 
                                       std::min(width - std::max(0, lex-eye_sz), 2*eye_sz), 
                                       std::min(height - std::max(0, ley-eye_sz), 2*eye_sz));
                cv::Rect right_eye_rect(std::max(0, rex-eye_sz), std::max(0, rey-eye_sz), 
                                        std::min(width - std::max(0, rex-eye_sz), 2*eye_sz), 
                                        std::min(height - std::max(0, rey-eye_sz), 2*eye_sz));
                cv::Rect skin_rect(std::max(0, mx-skin_sz), std::max(0, my), 
                                   std::min(width - std::max(0, mx-skin_sz), skin_sz), 
                                   std::min(height - std::max(0, my), skin_sz));

                if (left_eye_rect.width > 0 && left_eye_rect.height > 0 &&
                    right_eye_rect.width > 0 && right_eye_rect.height > 0 &&
                    skin_rect.width > 0 && skin_rect.height > 0) {

                    cv::Mat left_eye_roi = ir_face_crop(left_eye_rect).clone();
                    cv::Mat right_eye_roi = ir_face_crop(right_eye_rect).clone();
                    cv::Mat skin_roi = ir_face_crop(skin_rect).clone();

                    // Flatten and sort for eye (darkest 20% of eye area)
                    std::vector<uint8_t> left_vec;
                    left_vec.assign(left_eye_roi.datastart, left_eye_roi.dataend);
                    std::sort(left_vec.begin(), left_vec.end());
                    int left_eye_20 = std::max(1, static_cast<int>(left_vec.size() * 0.2));
                    double left_eye_sum = 0;
                    for (int i = 0; i < left_eye_20; ++i) left_eye_sum += left_vec[i];
                    double left_eye_mean = left_eye_sum / left_eye_20;

                    std::vector<uint8_t> right_vec;
                    right_vec.assign(right_eye_roi.datastart, right_eye_roi.dataend);
                    std::sort(right_vec.begin(), right_vec.end());
                    int right_eye_20 = std::max(1, static_cast<int>(right_vec.size() * 0.2));
                    double right_eye_sum = 0;
                    for (int i = 0; i < right_eye_20; ++i) right_eye_sum += right_vec[i];
                    double right_eye_mean = right_eye_sum / right_eye_20;

                    mean_eye = (left_eye_mean + right_eye_mean) / 2.0;

                    // Skin (brightest 20% of skin area)
                    std::vector<uint8_t> skin_vec;
                    skin_vec.assign(skin_roi.datastart, skin_roi.dataend);
                    std::sort(skin_vec.begin(), skin_vec.end());
                    int skin_20 = std::max(1, static_cast<int>(skin_vec.size() * 0.2));
                    double skin_sum = 0;
                    for (int i = 0; i < skin_20; ++i) {
                        skin_sum += skin_vec[skin_vec.size() - 1 - i];
                    }
                    mean_skin = skin_sum / skin_20;
                } else {
                    throw std::runtime_error("ROI out of bounds");
                }
            } catch (...) {
                // Fallback using global zones (split top 40% / bottom 40%)
                cv::Mat upper_half = ir_face_crop(cv::Range(0, static_cast<int>(height * 0.4)), cv::Range::all()).clone();
                cv::Mat lower_half = ir_face_crop(cv::Range(static_cast<int>(height * 0.6), height), cv::Range::all()).clone();
                
                std::vector<uint8_t> upper_vec;
                upper_vec.assign(upper_half.datastart, upper_half.dataend);
                std::sort(upper_vec.begin(), upper_vec.end());
                int upper_20 = std::max(1, static_cast<int>(upper_vec.size() * 0.2));
                double upper_sum = 0;
                for (int i = 0; i < upper_20; ++i) upper_sum += upper_vec[i];
                mean_eye = upper_sum / upper_20;

                std::vector<uint8_t> lower_vec;
                lower_vec.assign(lower_half.datastart, lower_half.dataend);
                std::sort(lower_vec.begin(), lower_vec.end());
                int lower_20 = std::max(1, static_cast<int>(lower_vec.size() * 0.2));
                double lower_sum = 0;
                for (int i = 0; i < lower_20; ++i) {
                    lower_sum += lower_vec[lower_vec.size() - 1 - i];
                }
                mean_skin = lower_sum / lower_20;
            }
        } else {
            // Fallback (no landmarks)
            cv::Mat upper_half = ir_face_crop(cv::Range(0, static_cast<int>(height * 0.4)), cv::Range::all()).clone();
            cv::Mat lower_half = ir_face_crop(cv::Range(static_cast<int>(height * 0.6), height), cv::Range::all()).clone();
            
            std::vector<uint8_t> upper_vec;
            upper_vec.assign(upper_half.datastart, upper_half.dataend);
            std::sort(upper_vec.begin(), upper_vec.end());
            int upper_20 = std::max(1, static_cast<int>(upper_vec.size() * 0.2));
            double upper_sum = 0;
            for (int i = 0; i < upper_20; ++i) upper_sum += upper_vec[i];
            mean_eye = upper_sum / upper_20;

            std::vector<uint8_t> lower_vec;
            lower_vec.assign(lower_half.datastart, lower_half.dataend);
            std::sort(lower_vec.begin(), lower_vec.end());
            int lower_20 = std::max(1, static_cast<int>(lower_vec.size() * 0.2));
            double lower_sum = 0;
            for (int i = 0; i < lower_20; ++i) {
                lower_sum += lower_vec[lower_vec.size() - 1 - i];
            }
            mean_skin = lower_sum / lower_20;
        }

        if (mean_eye == 0) mean_eye = 1.0;
        float contrast_ratio = (float)(mean_skin / mean_eye);

        // 5. Laplacian Variance (Texture Frequency Analysis)
        cv::Mat laplacian;
        cv::Laplacian(ir_face_crop, laplacian, CV_64F);
        cv::Scalar mu, sigma;
        cv::meanStdDev(laplacian, mu, sigma);
        float blur_var = (float)(sigma[0] * sigma[0]);

        // Log parameters to standard output
        std::printf("[C++ IRLivenessDetector] Brightness: %.2f, Hotspot: %.4f, Radial: %.3f, Contrast: %.2f, Laplacian: %.2f\n",
                    mean_brightness, hotspot_ratio, radial_ratio, contrast_ratio, blur_var);

        // Evaluate threshold conditions
        if (hotspot_ratio > max_hotspot_ratio) {
            res.is_live = false;
            res.score = hotspot_ratio;
            std::snprintf(res.reason, sizeof(res.reason), "Screen glare/Paper glass (ratio: %.3f)", hotspot_ratio);
            return res;
        }

        if (radial_ratio < min_radial_ratio) {
            res.is_live = false;
            res.score = radial_ratio;
            std::snprintf(res.reason, sizeof(res.reason), "Flat surface detected/No 3D depth (radial: %.2f)", radial_ratio);
            return res;
        }

        if (contrast_ratio < min_contrast_ratio) {
            res.is_live = false;
            res.score = contrast_ratio;
            std::snprintf(res.reason, sizeof(res.reason), "Low eye-skin contrast ratio (%.2f)", contrast_ratio);
            return res;
        }

        if (blur_var < min_blur_var) {
            res.is_live = false;
            res.score = blur_var;
            std::snprintf(res.reason, sizeof(res.reason), "Image blurry/Out of focus (variance: %.2f)", blur_var);
            return res;
        }

        if (blur_var > max_blur_var) {
            res.is_live = false;
            res.score = blur_var;
            std::snprintf(res.reason, sizeof(res.reason), "Moire/Print paper texture detected (variance: %.2f)", blur_var);
            return res;
        }

        res.is_live = true;
        res.score = contrast_ratio;
        std::strncpy(res.reason, "REAL", sizeof(res.reason));
        return res;
    }
}
