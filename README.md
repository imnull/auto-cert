# auto-cert

自动化 HTTPS 证书申请与部署工具 - 基于 Let's Encrypt 的纯手动 CLI 工具。

## 特性

- ✅ **纯手动操作** - 无后台服务，按需执行
- ✅ **HTTP-01 / DNS-01** - 支持两种验证方式
- ✅ **自动续期** - 检测证书有效期并自动续期
- ✅ **nginx 集成** - 自动生成符合最佳实践的 nginx 配置
- ✅ **Git 部署友好** - 通过 Git 部署到服务器后执行
- ✅ **YAML 配置** - 使用 YAML 格式配置文件，更易读写

## 安装

```bash
# 克隆仓库
git clone git@github.com:imnull/auto-cert.git
cd auto-cert

# 安装依赖
npm install

# 初始化配置
npm run setup
```

## 快速开始

### 1. 初始化配置

```bash
npm run setup
```

按提示输入：
- 联系邮箱（必需）
- 是否使用测试环境
- HTTP 验证根目录
- nginx 配置目录

配置将保存为 `config/config.yaml`：

```yaml
# auto-cert 配置文件
challengeType: http-01
email: admin@example.com
logLevel: info
nginxConfDir: /etc/nginx/conf.d
nginxSitesDir: /etc/nginx/sites-enabled
staging: false
webRoot: /var/www/html
```

### 2. 申请证书

```bash
# HTTP-01 验证（需要 80 端口可访问）
npm run cert:issue -- --domain example.com

# 或使用完整命令
npx auto-cert issue -d example.com
```

### 3. 部署到 nginx

```bash
npm run cert:deploy -- --domain example.com --upstream localhost --port 3000
```

## 命令参考

### 初始化与配置

```bash
# 交互式初始化（推荐首次使用）
npm run setup

# 快速创建默认 config.yaml（如果不存在）
npm run config:init

# 快速添加域名记录
npm run domain:add -- example.com
```

### 证书管理

```bash
# 申请新证书
auto-cert issue -d <domain> [-e <email>] [--staging] [-t http-01|dns-01]

# 续期证书
auto-cert renew -d <domain> [--days 30] [--force]

# 续期所有即将过期的证书
auto-cert renew-all [--days 30]

# 检查证书有效期
auto-cert check [-d <domain>]
```

### nginx 部署

```bash
# 部署证书并生成 nginx 配置
auto-cert deploy -d <domain> [-u <upstream>] [-p <port>] [-w <webroot>]

# 仅生成 nginx 配置（输出到 stdout）
auto-cert nginx-generate -d <domain> [-u <upstream>] [-p <port>]
```

## 配置

### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `AUTO_CERT_EMAIL` | 联系邮箱 | - |
| `AUTO_CERT_STAGING` | 使用测试环境 | `false` |
| `AUTO_CERT_CERTS` | 证书存储目录 | `./certs` |
| `AUTO_CERT_CONFIG` | 配置文件目录 | `./config` |
| `AUTO_CERT_WEBROOT` | HTTP 验证根目录 | `/var/www/html` |
| `AUTO_CERT_NGINX_CONF` | nginx 配置目录 | `/etc/nginx/conf.d` |

### 配置文件

支持 YAML 格式（`config/config.yaml`）：

```yaml
# auto-cert 配置文件
email: admin@example.com
staging: false
webRoot: /var/www/html
challengeType: http-01
nginxConfDir: /etc/nginx/conf.d
nginxSitesDir: /etc/nginx/sites-enabled
logLevel: info

# DNS 配置（使用 DNS-01 验证时）
dnsProvider: cloudflare
dnsCredentials:
  apiToken: your-api-token
```

配置优先级：命令行参数 > 环境变量 > 配置文件 > 默认值

## 项目结构

```
auto-cert/
├── bin/
│   └── auto-cert.js          # CLI 入口
├── lib/
│   ├── index.js              # 主类
│   ├── config.js             # 配置管理（YAML 支持）
│   ├── certificate.js        # 证书管理
│   ├── nginx.js              # nginx 部署
│   └── challenges/
│       ├── http-01.js        # HTTP-01 验证
│       └── dns-01.js         # DNS-01 验证
├── config/                   # 配置文件
│   ├── config.yaml           # 主配置（YAML）
│   └── domains.yaml          # 域名配置（YAML）
│                               #   issuedAt: 证书签发时间（首次申请成功的时间）
│                               #   email: 申请时使用的邮箱
│                               #   注意：不是过期时间！证书有效期为 90 天
├── certs/                    # 证书存储（gitignored）
│   └── example.com/
│       ├── privkey.pem       # 私钥
│       ├── cert.pem          # 证书
│       ├── chain.pem         # 中间证书
│       └── fullchain.pem     # 完整证书链
├── scripts/
│   ├── setup.js              # 交互式初始化
│   ├── config-init.js        # 快速创建默认配置
│   └── domain-add.js         # 快速添加域名记录
├── nodejs-master/            # Kimi CLI Skill（开发工具）
│   ├── SKILL.md              # 技能文档
│   ├── references/           # ACME/nginx 参考资料
│   ├── scripts/              # 代码模板
│   └── assets/               # 项目模板
├── nodejs-master.skill       # 打包后的 Skill 文件
├── package.json
├── README.md
└── .gitignore
```

## 关于 Kimi CLI Skill

本项目包含一个 **Kimi Code CLI Skill** (`nodejs-master/`)，用于帮助 Kimi CLI 用户开发类似的 Node.js 证书管理工具。

### 什么是 Skill？

Skill 是 Kimi Code CLI 的扩展机制，包含：
- **领域知识**：ACME 协议详解、nginx 最佳实践
- **代码模板**：可复用的脚本实现
- **工作流指导**：证书申请/部署的完整流程

### 适用人群

| 用户类型 | 是否需要关注 |
|----------|--------------|
| 只使用 auto-cert | ❌ 不需要，直接安装使用即可 |
| 想开发类似工具 | ✅ 可安装此 Skill 获取指导 |
| Kimi CLI 用户 | ✅ 可安装增强相关开发能力 |

### 安装 Skill

```bash
# 从本仓库安装
kimi-cli skills install ./nodejs-master/

# 或打包后安装
kimi-cli skills install nodejs-master.skill
```

安装后，当你在 Kimi CLI 中询问 Node.js 证书相关问题时，会自动触发此 Skill 提供专业指导。

### 非 Kimi CLI 用户

可忽略 `nodejs-master/` 目录，直接阅读本 README 使用 auto-cert 即可。

## nginx 部署详解

### 部署逻辑

auto-cert 的部署命令 (`npm run cert:deploy`) 会智能处理 nginx 配置，遵循以下逻辑：

#### 1. 检查现有配置

部署前会自动检查目标配置文件是否存在：

```bash
# 本地部署检查
/etc/nginx/conf.d/{domain}.conf

# 远程部署检查
{remoteNginxConfDir}/{domain}.conf
```

#### 2. 三种处理场景

| 场景 | 处理方式 | 说明 |
|------|----------|------|
| **无现有配置** | 创建全新配置 | 生成完整的 HTTP + HTTPS server 块 |
| **只有 HTTP 配置** | **智能转换** | 保留原有 HTTP 配置，添加 HTTPS server 块 |
| **已有 HTTPS 配置** | 直接跳过 | 不做任何修改，避免覆盖用户自定义配置 |

#### 3. 智能转换示例

假设你已有以下 HTTP 配置：

```nginx
# /etc/nginx/conf.d/example.conf
server {
    listen 80;
    server_name example.com;
    
    location / {
        proxy_pass http://localhost:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
    
    location /api {
        proxy_pass http://localhost:3000;
    }
}
```

执行部署后，会自动添加 HTTPS 配置：

```nginx
# /etc/nginx/conf.d/example.conf
server {
    listen 80;
    server_name example.com;
    
    # ACME 验证路径（自动添加）
    location /.well-known/acme-challenge/ {
        alias /var/www/html/.well-known/acme-challenge/;
    }
    
    # 保留原有所有 location
    location / {
        proxy_pass http://localhost:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
    
    location /api {
        proxy_pass http://localhost:3000;
    }
}

# 自动添加的 HTTPS 配置
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name example.com;
    
    # SSL 证书（使用 fullchain.pem 包含完整证书链）
    ssl_certificate /etc/nginx/certs/example.com/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/example.com/privkey.pem;
    
    # SSL 安全配置
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:50m;
    
    # 安全响应头
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    
    # 保留原有的 location 配置
    location / {
        proxy_pass http://localhost:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
    
    location /api {
        proxy_pass http://localhost:3000;
    }
}
```

**注意**：
- 原有的 HTTP 配置完全保留
- 所有 `location` 配置自动复制到 HTTPS server
- 仅添加 SSL 相关配置和 ACME 验证路径
- 不会修改你的任何自定义配置

### 证书文件说明

部署后证书文件存放在以下位置：

**本地模式**：
```
./certs/{domain}/
├── privkey.pem    # 私钥（权限 600）
├── cert.pem       # 服务器证书
├── chain.pem      # 中间证书链
└── fullchain.pem  # 证书 + 中间证书（推荐用于 nginx）
```

**远程模式**：
```
{remoteCertsDir}/{domain}/
├── privkey.pem
├── cert.pem
├── chain.pem
└── fullchain.pem
```

### 为什么使用 fullchain.pem？

**证书链结构**：
```
根证书 (ISRG Root X1) [系统内置]
    ↓ 签名
中间证书 (R3) [包含在 fullchain.pem]
    ↓ 签名
服务器证书 [包含在 fullchain.pem]
```

nginx 配置必须使用 `fullchain.pem`：

```nginx
# ✅ 正确 - 包含完整证书链
ssl_certificate /etc/nginx/certs/example.com/fullchain.pem;
ssl_certificate_key /etc/nginx/certs/example.com/privkey.pem;

# ❌ 错误 - 缺少中间证书，会导致证书信任警告
ssl_certificate /etc/nginx/certs/example.com/cert.pem;
```

使用 `cert.pem` 可能导致：
- 浏览器显示"证书不受信任"
- 部分客户端无法建立 HTTPS 连接
- SSL 检测工具报告证书链不完整

### 部署命令详解

#### 基础部署

```bash
# 部署指定域名的证书和 nginx 配置
npm run cert:deploy -- --domain example.com
```

#### 强制部署

如果 `autoDeploy` 配置为 `false`，需要加 `--force`：

```bash
npm run cert:deploy -- --domain example.com --force
```

#### 指定上游服务器

```bash
# 指定后端应用地址（默认 localhost:3000）
npm run cert:deploy -- --domain example.com --upstream 127.0.0.1 --port 8080
```

#### 自定义配置路径

```bash
# 指定 nginx 配置目录（默认 /etc/nginx/conf.d）
npm run cert:deploy -- --domain example.com --conf-dir /usr/local/etc/nginx/conf.d
```

#### 跳过备份和重载

```bash
# 不备份现有配置
npm run cert:deploy -- --domain example.com --no-backup

# 不重载 nginx（仅更新配置）
npm run cert:deploy -- --domain example.com --no-reload

# 两者都跳过
npm run cert:deploy -- --domain example.com --no-backup --no-reload
```

### 手动配置 nginx（可选）

如果自动部署不符合需求，可以手动配置：

#### 1. 仅生成配置（不部署）

```bash
npm run nginx:generate -- --domain example.com
```

输出示例：
```nginx
server {
    listen 80;
    server_name example.com;
    
    location /.well-known/acme-challenge/ {
        alias /var/www/html/.well-known/acme-challenge/;
    }
    
    location / {
        return 301 https://$server_name$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name example.com;
    
    ssl_certificate /etc/nginx/certs/example.com/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/example.com/privkey.pem;
    
    # ... SSL 配置
    
    location / {
        proxy_pass http://localhost:3000;
    }
}
```

#### 2. 手动复制到服务器

```bash
# 本地生成配置重定向到文件
npm run nginx:generate -- --domain example.com > /tmp/example.conf

# 上传到远程服务器
scp /tmp/example.conf root@server:/etc/nginx/conf.d/

# 测试并重载 nginx
ssh root@server "nginx -t && nginx -s reload"
```

#### 3. 手动上传证书

```bash
# 使用 scp 上传证书
scp -r certs/example.com root@server:/etc/nginx/certs/

# 设置权限
ssh root@server "chmod 600 /etc/nginx/certs/example.com/privkey.pem"
```

### SSL 配置最佳实践

generated nginx 配置包含以下安全特性：

- **TLS 1.2 / TLS 1.3** 协议（禁用旧版 TLS 1.0/1.1）
- **强加密套件**（前向安全，兼容性和安全性平衡）
- **HSTS**（HTTP Strict Transport Security，强制 HTTPS）
- **安全响应头**：
  - `X-Frame-Options: SAMEORIGIN`（防止点击劫持）
  - `X-Content-Type-Options: nosniff`（防止 MIME 嗅探）
  - `X-XSS-Protection: 1; mode=block`（XSS 防护）
  - `Referrer-Policy: strict-origin-when-cross-origin`（隐私保护）
- **SSL Session 缓存**（提升性能）

**注意**：配置默认不包含 `ssl_stapling on`，因为 Let's Encrypt 证书的 OCSP URL 有时会导致警告。如需启用，请手动添加：

```nginx
ssl_stapling on;
ssl_stapling_verify on;
ssl_trusted_certificate /etc/nginx/certs/example.com/chain.pem;
```

## 部署工作流

### 通过 Git 部署到服务器

```bash
# 本地开发
npm run cert:issue -- --domain example.com

# 提交代码
git add .
git commit -m "add certificate"
git push origin main

# 在服务器上
ssh user@server
cd /path/to/auto-cert
npm install
npm run cert:deploy -- --domain example.com
```

### 服务器 Git Hook（可选）

配置 `post-receive` hook 实现自动部署：

```bash
#!/bin/bash
TARGET="/opt/auto-cert"
git --work-tree=$TARGET checkout -f
cd $TARGET && npm install
```

## SSH 远程模式

auto-cert 支持通过 SSH 在远程服务器上申请和部署证书，适用于以下场景：

- 本地跳板机管理多台远程服务器
- 证书服务器与 Web 服务器分离
- 内网服务器通过有公网 IP 的跳板机申请证书

### 配置方法

编辑 `config/domains.yaml` 添加 SSH 配置：

```yaml
remote.example.com:
  issuedAt: ''
  email: admin@example.com
  
  # SSH 远程配置（除 host 外均为可选，使用默认值）
  ssh:
    host: remote-server.com          # 【必需】远程服务器地址
    # port: 22                       # SSH 端口（默认 22）
    # username: root                 # 登录用户名（默认 root）
    # privateKey: ~/.ssh/id_rsa      # 私钥路径（默认使用 SSH agent 或 ~/.ssh/id_rsa）
    
    # 远程服务器路径配置
    remoteWebRoot: /var/www/html                    # 远程 web 根目录
    remoteNginxConfDir: /etc/nginx/conf.d           # 远程 nginx 配置目录
    remoteCertsDir: /opt/auto-cert/certs            # 远程证书存放目录
```

### 工作流程

```
┌─────────┐                    ┌─────────────────┐
│  本地   │ ─── SSH 连接 ────▶ │   远程服务器    │
│         │                    │                 │
│ 申请证书 │ ── 在远程创建 ───▶ │ 验证文件        │
│         │    验证文件        │ .well-known/    │
│         │                    │                 │
│ 下载证书 │ ◀── 验证通过 ─────│ Let's Encrypt   │
│         │                    │ 访问验证        │
│         │                    │                 │
│ 上传证书 │ ─── SCP/SFTP ───▶ │ 证书文件        │
│         │                    │                 │
│ 部署配置 │ ─── 远程执行 ────▶ │ nginx 配置      │
│         │                    │ nginx -s reload │
└─────────┘                    └─────────────────┘
```

### 使用方式

#### 最简配置（如果你已配置 SSH 免密登录）

```yaml
# config/domains.yaml
remote.example.com:
  issuedAt: ''
  email: admin@example.com
  ssh:
    host: remote-server.com
    remoteWebRoot: /var/www/html
    remoteNginxConfDir: /etc/nginx/conf.d
    remoteCertsDir: /opt/auto-cert/certs
```

#### 完整配置（自定义选项）

```yaml
remote.example.com:
  issuedAt: ''
  email: admin@example.com
  ssh:
    host: remote-server.com
    port: 2222                    # 非默认端口
    username: deploy              # 非 root 用户
    privateKey: ~/.ssh/deploy_key # 指定私钥
    remoteWebRoot: /var/www/html
    remoteNginxConfDir: /etc/nginx/conf.d
    remoteCertsDir: /opt/auto-cert/certs
```

#### 命令

```bash
# 申请证书（自动识别 SSH 远程模式）
npm run cert:issue -- --domain remote.example.com

# 部署到远程 nginx
npm run cert:deploy -- --domain remote.example.com
```

### SSH 密钥配置

确保本地可以通过 SSH 免密登录远程服务器：

```bash
# 生成密钥对（如果没有）
ssh-keygen -t rsa -b 4096 -C "auto-cert"

# 复制公钥到远程服务器
ssh-copy-id -i ~/.ssh/id_rsa.pub root@remote-server.com

# 测试免密登录
ssh root@remote-server.com "echo '连接成功'"
```

### 安全建议

- 使用 SSH 密钥登录，避免密码
- 私钥文件权限设置为 `600`
- 使用专用账户（非 root），并配置 sudo 免密
- 考虑使用 SSH agent 管理密钥

## 注意事项

1. **权限**：
   - 证书目录需要适当权限（私钥 `600`，证书 `644`）
   - nginx 配置目录可能需要 root 权限

2. **端口**：
   - HTTP-01 验证需要服务器 80 端口可访问
   - 或使用 DNS-01 验证（需要 DNS 服务商 API）

3. **HTTP-01 验证流程**：

   HTTP-01 验证需要 Let's Encrypt 服务器能够访问你的服务器：

   ```
   1. auto-cert 在本地创建验证文件
      → {webRoot}/.well-known/acme-challenge/xxx

   2. Let's Encrypt 服务器访问
      → http://your-domain/.well-known/acme-challenge/xxx

   3. 如果返回正确内容 → 验证通过 ✅
      如果返回 404 → 验证失败 ❌
   ```

   **nginx 必须配置 80 端口的 `.well-known` 路径**：

   ```nginx
   server {
       listen 80;
       server_name your-domain.com;

       # ACME 挑战 - 必须配置！
       location /.well-known/acme-challenge/ {
           alias /usr/local/etc/nginx/www/html/.well-known/acme-challenge/;
       }

       location / {
           return 301 https://$server_name$request_uri;
       }
   }
   ```

   **验证前测试**：

   ```bash
   # 1. 创建测试文件
   echo "test-content" | sudo tee /usr/local/etc/nginx/www/html/.well-known/acme-challenge/test

   # 2. 本地测试访问
   curl http://your-domain/.well-known/acme-challenge/test
   # 应该输出: test-content

   # 3. 测试通过后删除
   rm /usr/local/etc/nginx/www/html/.well-known/acme-challenge/test
   ```

   **常见 404 原因**：
   - 80 端口未开放（防火墙/安全组）
   - nginx 未配置 `.well-known` 路径
   - `webRoot` 路径与 nginx `alias` 不匹配
   - 路径权限问题

4. **测试环境**：
   - 开发测试时添加 `--staging` 参数
   - 避免触发生产环境速率限制

## 许可证

MIT
