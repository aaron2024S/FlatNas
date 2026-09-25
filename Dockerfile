# Stage 1: Build Frontend
#
# 这里必须写 --platform=$BUILDPLATFORM（构建机架构），不要用目标架构：
#   前端产物只是静态的 JS / HTML / CSS，与 CPU 架构无关，没必要为 arm64 再跑一遍。
#   不写这一句时，构建 arm64 镜像会在 x86 的构建机上用 QEMU 模拟着「跑 npm ci」，
#   既慢 5~10 倍，又极易让 npm 直接崩掉 —— 实测 GitHub Actions 第 1 次构建就挂在
#   `[linux/arm64 ...] RUN npm ci`，报 exit code 146；而同一次构建里 amd64 那条腿的
#   npm ci 与 npm run build-only 都正常。
#   后端 stage（backend-builder）本来就是「BUILDPLATFORM + 交叉编译」的写法，
#   前端也改成同样写法后，整个构建过程不再需要 QEMU。
FROM --platform=$BUILDPLATFORM node:20.19-bookworm-slim AS frontend-builder

# 1. 接收构建参数（代理地址）
ARG HTTP_PROXY
ARG HTTPS_PROXY

# 2. 设置环境变量
ENV HTTP_PROXY=$HTTP_PROXY \
    HTTPS_PROXY=$HTTPS_PROXY \
    NPM_CONFIG_REGISTRY=https://registry.npmmirror.com

WORKDIR /app

# 说明：上游这里原本有一行 `COPY server/public ./server/public`，
# 是为了让 Vite 拿 server/public 当 publicDir。但 frontend/vite.config.ts 里
# publicDir 已经固定写成 frontend/public（见该文件「始终从 frontend/public
# 复制静态素材」那段注释），server/public 在本地只是构建**输出**目录、
# 不进仓库，所以这一行已经多余；留着反而会让「仓库里没有 server/public」
# 的干净克隆直接构建失败。故删除。
WORKDIR /app/frontend

# Copy package files first to cache dependencies
COPY frontend/package.json frontend/package-lock.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY frontend/ .

# Build frontend（publicDir 是 frontend/public，见 vite.config.ts；产物出到 /app/frontend/dist）
ENV TAILWIND_DISABLE_NATIVE=1
ENV VITE_DOCKER_BUILD=1
RUN npm run build-only

# Stage 2: Build Backend
FROM --platform=$BUILDPLATFORM golang:alpine AS backend-builder

# 接收构建参数
ARG HTTP_PROXY
ARG HTTPS_PROXY
# Go Proxy 设置，默认使用 goproxy.cn
ARG GOPROXY=https://goproxy.cn,direct

ENV HTTP_PROXY=$HTTP_PROXY \
    HTTPS_PROXY=$HTTPS_PROXY \
    GOPROXY=$GOPROXY

WORKDIR /app/backend

# Copy go mod files
COPY backend/go.mod backend/go.sum ./

# Download dependencies
RUN go mod download

# Copy source code
COPY backend/ .

# Build binary
# Use ARG TARGETOS and TARGETARCH to support cross-compilation
ARG TARGETOS
ARG TARGETARCH
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -ldflags="-s -w" -o flatnas-backend .

# Stage 3: Final Image
FROM alpine:latest

WORKDIR /app

# Install necessary runtime dependencies
# tzdata is important for correct timezone handling
RUN apk --no-cache add ca-certificates tzdata

# 设置时区和 Gin 模式
ENV TZ=Asia/Shanghai \
    GIN_MODE=release \
    BASE_DIR=/app

# Copy backend binary
COPY --from=backend-builder /app/backend/flatnas-backend .

# Copy frontend dist to public directory
# This includes the built assets and the static files copied from server/public during build
COPY --from=frontend-builder /app/frontend/dist ./server/public

# Create necessary directories for volumes
RUN mkdir -p server/data server/music server/PC server/APP server/doc server/icon-cache

# Expose port
EXPOSE 3000

# Run the application
CMD ["./flatnas-backend"]
