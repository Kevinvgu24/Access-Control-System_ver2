# ========================================================
# Stage 1: Build the React Frontend Dashboard
# ========================================================
FROM node:20-alpine AS frontend-builder
WORKDIR /build

# Copy npm configuration files first to cache dependencies layer
COPY web_app/package.json ./
RUN npm install --legacy-peer-deps

# Copy the rest of the web app files and build it
COPY web_app/ ./
RUN npm run build

# ========================================================
# Stage 2: Package the Flask Backend Server
# ========================================================
FROM python:3.10-slim
WORKDIR /app

# Set system timezone to ICT (Vietnam UTC+7)
ENV TZ=Asia/Ho_Chi_Minh

# Install curl and tzdata for accurate local timezone support
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl tzdata \
    && rm -rf /var/lib/apt/lists/*

# Install minimal python dependencies for the API server
# (No NPU or OpenCV libraries needed on the central dashboard server)
RUN pip install --no-cache-dir flask flask-cors numpy qdrant-client openpyxl paho-mqtt

# Copy backend Python source files
COPY src/ /app/src/
COPY run_schedule_parser.py /app/

# Copy built React frontend assets from Stage 1 into the location expected by api_server.py
COPY --from=frontend-builder /build/dist /app/web_app/dist

# Expose the Flask port
EXPOSE 5000

# Declare database folder as a persistent volume
VOLUME /app/database

# Run the API server
CMD ["python", "src/Newest_Version/api_server.py"]
