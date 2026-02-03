# nginx SSL/TLS 最佳实践

## 配置概览

现代 nginx SSL 配置应该遵循以下原则：
- 仅启用 TLS 1.2 和 TLS 1.3
- 使用强加密套件
- 启用 HSTS
- 配置 OCSP Stapling
- 优化 SSL Session

## 推荐配置

### 基础 SSL 配置

```nginx
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name example.com;

    # 证书路径
    ssl_certificate /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;

    # 协议版本 - 仅允许 TLS 1.2 和 1.3
    ssl_protocols TLSv1.2 TLSv1.3;

    # 加密套件配置
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;

    # Session 配置
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:50m;
    ssl_session_tickets off;

    # HSTS (HTTP Strict Transport Security)
    add_header Strict-Transport-Security "max-age=63072000" always;

    # OCSP Stapling
    ssl_stapling on;
    ssl_stapling_verify on;
    ssl_trusted_certificate /path/to/chain.pem;
    resolver 8.8.8.8 8.8.4.4 valid=300s;
    resolver_timeout 5s;
}
```

### HTTP 到 HTTPS 重定向

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name example.com;
    
    # ACME challenge 排除
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }
    
    # 其他所有请求重定向到 HTTPS
    location / {
        return 301 https://$server_name$request_uri;
    }
}
```

## 安全响应头

```nginx
# 添加到 server 块
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Content-Security-Policy "default-src 'self'" always;
```

## 性能优化

### SSL Session 复用

```nginx
# 共享 session 缓存
ssl_session_cache shared:SSL:50m;  # 50MB 缓存，约可存储 200,000 个 session
ssl_session_timeout 1d;            # Session 有效期 1 天
ssl_session_tickets off;           # 禁用 tickets（前向安全性考虑）
```

### 启用 HTTP/2

```nginx
listen 443 ssl http2;
```

HTTP/2 优势：
- 多路复用（单一连接并行传输）
- 头部压缩（HPACK）
- 服务器推送

### 动态 TLS 记录大小

```nginx
ssl_buffer_size 4k;  # 默认值，可根据场景调整
```

- 小值（1k）：低延迟优先（API、WebSocket）
- 大值（16k）：吞吐量优先（文件下载）

## 加密套件详解

### 推荐套件（按优先级排序）

| 套件 | 密钥交换 | 认证 | 加密 | 哈希 |
|------|---------|------|------|------|
| ECDHE-ECDSA-AES128-GCM-SHA256 | ECDHE | ECDSA | AES-128-GCM | SHA256 |
| ECDHE-RSA-AES128-GCM-SHA256 | ECDHE | RSA | AES-128-GCM | SHA256 |
| ECDHE-ECDSA-AES256-GCM-SHA384 | ECDHE | ECDSA | AES-256-GCM | SHA384 |
| ECDHE-RSA-AES256-GCM-SHA384 | ECDHE | RSA | AES-256-GCM | SHA384 |
| ECDHE-ECDSA-CHACHA20-POLY1305 | ECDHE | ECDSA | ChaCha20-Poly1305 | - |
| ECDHE-RSA-CHACHA20-POLY1305 | ECDHE | RSA | ChaCha20-Poly1305 | - |

### 套件选择原则

1. **ECDHE** - 提供前向安全性（Forward Secrecy）
2. **AES-GCM** - 认证加密，防篡改
3. **ChaCha20-Poly1305** - 在移动设备上性能更好
4. **禁用弱套件**：RC4、DES、3DES、MD5、SHA1、NULL

## OCSP Stapling 配置

OCSP Stapling 允许服务器在 TLS 握手时提供证书状态信息，减少客户端验证延迟。

```nginx
ssl_stapling on;
ssL_stapling_verify on;

# 中间证书路径
ssl_trusted_certificate /etc/nginx/ssl/chain.pem;

# DNS 解析器（用于查询 OCSP 响应器）
resolver 8.8.8.8 8.8.4.4 1.1.1.1 valid=300s;
resolver_timeout 5s;
```

验证 OCSP Stapling 是否生效：

```bash
openssl s_client -connect example.com:443 -status | grep OCSP
```

## HSTS 配置

```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

参数说明：
- `max-age`：HSTS 有效期（秒），63072000 = 2 年
- `includeSubDomains`：应用到所有子域名
- `preload`：同意加入浏览器预加载列表

**注意**: 启用 preload 前确保：
1. 所有子域名都支持 HTTPS
2. 无法回退到 HTTP
3. 提交到 https://hstspreload.org/

## 完整生产配置示例

```nginx
# HTTP 服务器 - 重定向到 HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name example.com www.example.com;
    
    # ACME challenge
    location /.well-known/acme-challenge/ {
        root /var/www/html;
        allow all;
    }
    
    location / {
        return 301 https://$server_name$request_uri;
    }
}

# HTTPS 服务器
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name example.com www.example.com;

    root /var/www/example.com;
    index index.html;

    # SSL 证书
    ssl_certificate /etc/letsencrypt/live/example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;
    ssl_trusted_certificate /etc/letsencrypt/live/example.com/chain.pem;

    # SSL 配置
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:50m;
    ssl_session_tickets off;
    ssl_stapling on;
    ssl_stapling_verify on;
    resolver 8.8.8.8 8.8.4.4 1.1.1.1 valid=300s;
    resolver_timeout 5s;

    # 安全头
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # 日志
    access_log /var/log/nginx/example.com.access.log;
    error_log /var/log/nginx/example.com.error.log;

    # 静态文件缓存
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # 反向代理到应用服务器
    location /api/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # 前端路由支持
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

## 配置验证

```bash
# 检查配置语法
nginx -t

# 重载配置
nginx -s reload

# 测试 SSL 配置
nmap --script ssl-enum-ciphers -p 443 example.com

# SSL Labs 测试（最权威）
# https://www.ssllabs.com/ssltest/
```

## A+ 评分检查清单

- [x] TLS 1.2 和/或 TLS 1.3 支持
- [x] 弱加密套件已禁用
- [x] HSTS 已启用且 max-age ≥ 1 年
- [x] HSTS includeSubDomains 已启用
- [x] OCSP Stapling 已启用
- [x] 证书链完整
- [x] 证书有效期 ≤ 397 天（Let's Encrypt 标准）
- [x] 使用 DNS CAA 记录限制证书颁发机构
