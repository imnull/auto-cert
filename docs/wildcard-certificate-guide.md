# 通配符证书使用指南

## 概述

本文档介绍如何使用 auto-cert 申请和部署通配符证书（Wildcard Certificate）。

通配符证书可以为一个域名下的所有子域名提供 HTTPS 加密，例如 `*.clawcave.rockicat.com` 可以保护：
- `api.clawcave.rockicat.com`
- `admin.clawcave.rockicat.com`
- `dev.clawcave.rockicat.com`
- 以及任何其他三级域名

## 前置条件

### 1. DNS 服务商配置

通配符证书必须使用 **DNS-01 验证**，需要你的域名托管在支持的 DNS 服务商处。

**当前支持的 DNS 服务商**：
- ✅ Cloudflare（已实现）
- 🚧 阿里云 DNS（待实现）
- 🚧 AWS Route53（待实现）

### 2. 获取 Cloudflare API Token

如果你使用 Cloudflare 管理域名，需要创建 API Token：

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 点击右上角用户图标 → **My Profile**
3. 选择左侧 **API Tokens**
4. 点击 **Create Token**
5. 选择 **Custom token**，配置以下权限：
   - `Zone` → `DNS` → `Edit` ✅
   - `Zone` → `Zone` → `Read` ✅
6. 选择对应的 Zone（域名）
7. 点击 **Continue to summary** → **Create Token**
8. **立即复制 Token**（只显示一次！）

### 3. 验证域名配置

确保你的域名已经：
- ✅ 添加到 Cloudflare
- ✅ 使用 Cloudflare 的 DNS 服务（NS 记录指向 Cloudflare）

## 使用方法

### 基础命令

```bash
# 申请通配符证书
npx auto-cert issue \
  -d "*.clawcave.rockicat.com" \
  -t dns-01 \
  --dns-provider cloudflare \
  --dns-token YOUR_CLOUDFLARE_API_TOKEN \
  --email your-email@example.com
```

### 完整示例（含测试环境）

首次使用建议在测试环境验证：

```bash
# 1. 测试环境申请（不会触发速率限制）
npx auto-cert issue \
  -d "*.clawcave.rockicat.com" \
  -t dns-01 \
  --dns-provider cloudflare \
  --dns-token YOUR_API_TOKEN \
  --email admin@example.com \
  --staging

# 2. 检查证书状态
npx auto-cert check -d "*.clawcave.rockicat.com"

# 3. 测试通过后，申请正式证书
npx auto-cert issue \
  -d "*.clawcave.rockicat.com" \
  -t dns-01 \
  --dns-provider cloudflare \
  --dns-token YOUR_API_TOKEN \
  --email admin@example.com
```

### 多域名 SAN 证书

如果需要同时保护主域名和所有子域名：

```bash
npx auto-cert issue \
  -d "clawcave.rockicat.com,*.clawcave.rockicat.com" \
  -t dns-01 \
  --dns-provider cloudflare \
  --dns-token YOUR_API_TOKEN \
  --email admin@example.com
```

### 使用配置文件

可以将 DNS 凭证保存到配置文件，避免每次输入：

```yaml
# config/config.yaml
email: admin@example.com
staging: false
challengeType: dns-01
dnsProvider: cloudflare
dnsCredentials:
  apiToken: YOUR_API_TOKEN
```

然后简化命令：

```bash
npx auto-cert issue -d "*.clawcave.rockicat.com"
```

### 使用环境变量

```bash
# 设置环境变量
export AUTO_CERT_EMAIL=admin@example.com
export CLOUDFLARE_API_TOKEN=YOUR_API_TOKEN

# 使用环境变量申请
npx auto-cert issue \
  -d "*.clawcave.rockicat.com" \
  -t dns-01 \
  --dns-provider cloudflare \
  --dns-token $CLOUDFLARE_API_TOKEN
```

## 工作原理

### DNS-01 验证流程

```
┌─────────────┐
│  auto-cert  │
│  (本地执行)  │
└──────┬──────┘
       │
       │ 1. 创建 ACME 订单
       │    域名: *.clawcave.rockicat.com
       ▼
┌─────────────────┐
│  Let's Encrypt  │
│  ACME Server    │
└──────┬──────────┘
       │
       │ 2. 返回 DNS 挑战
       │    需要添加 TXT 记录
       ▼
┌──────────────────────────────────────┐
│  DNS 挑战详情                         │
│  记录名: _acme-challenge.clawcave... │
│  记录值: xxxxxxxxxxxxxxxxxxxxxxxx    │
└──────────────────────────────────────┘
       │
       │ 3. auto-cert 调用 Cloudflare API
       │    自动添加 TXT 记录
       ▼
┌─────────────────┐
│   Cloudflare    │
│   DNS Server    │
└──────┬──────────┘
       │
       │ 4. 等待 DNS 传播（30-60 秒）
       │    auto-cert 自动检测
       ▼
┌─────────────────┐
│  Let's Encrypt  │
│  验证 DNS 记录   │
└──────┬──────────┘
       │
       │ 5. 验证通过 → 颁发证书
       │    验证失败 → 重试
       ▼
┌─────────────┐
│  auto-cert  │
│  下载证书    │
│  清理 DNS 记录│
└─────────────┘
```

### 自动清理

证书申请成功后，auto-cert 会自动：
1. 删除创建的 DNS TXT 记录
2. 保存证书到 `certs/*.clawcave.rockicat.com/` 目录
3. 更新 `config/domains.yaml` 记录

## 证书文件结构

申请完成后，证书文件存放在：

```
certs/
└── *.clawcave.rockicat.com/
    ├── privkey.pem    # 私钥（权限 600）
    ├── cert.pem       # 服务器证书
    ├── chain.pem      # 中间证书链
    └── fullchain.pem  # 完整证书链（nginx 使用）
```

## Nginx 配置

### 生成配置

```bash
npx auto-cert nginx-generate \
  -d "*.clawcave.rockicat.com" \
  --upstream localhost \
  --port 3000
```

### 示例配置

```nginx
server {
    listen 80;
    server_name *.clawcave.rockicat.com;

    # ACME 挑战路径（用于续期）
    location /.well-known/acme-challenge/ {
        alias /var/www/html/.well-known/acme-challenge/;
    }

    location / {
        return 301 https://$server_name$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name *.clawcave.rockicat.com;

    # SSL 证书
    ssl_certificate /etc/nginx/certs/*.clawcave.rockicat.com/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/*.clawcave.rockicat.com/privkey.pem;

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

    # 反向代理
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## 证书续期

Let's Encrypt 证书有效期为 90 天，建议提前 30 天续期：

```bash
# 续期指定证书
npx auto-cert renew \
  -d "*.clawcave.rockicat.com" \
  -t dns-01 \
  --dns-provider cloudflare \
  --dns-token YOUR_API_TOKEN

# 续期所有证书
npx auto-cert renew-all \
  -t dns-01 \
  --dns-provider cloudflare \
  --dns-token YOUR_API_TOKEN
```

## 常见问题

### Q1: DNS 传播失败怎么办？

**现象**：等待 DNS 传播超时

**解决方案**：
1. 检查 Cloudflare API Token 权限是否正确
2. 手动检查 DNS 记录是否创建成功
3. 增加 `--no-cleanup` 参数保留记录便于调试
4. 等待更长时间（部分情况 DNS 传播可能需要 5-10 分钟）

### Q2: 通配符证书是否支持二级域名？

**支持**。例如：
- `*.example.com` 可以保护 `a.example.com`、`b.example.com`
- `*.clawcave.rockicat.com` 可以保护 `api.clawcave.rockicat.com`

**不支持**多级通配符：
- ❌ `*.*.example.com` 不被支持
- ❌ `*.sub.example.com` 不能保护 `sub.example.com`

### Q3: 通配符证书和 SAN 证书有什么区别？

- **通配符证书**：`*.example.com`，保护所有子域名
- **SAN 证书**：可以指定多个具体域名，如 `a.example.com, b.example.com, c.example.com`

你也可以申请包含通配符的 SAN 证书：
```bash
npx auto-cert issue \
  -d "example.com,*.example.com,api.example.com" \
  -t dns-01 \
  --dns-provider cloudflare \
  --dns-token YOUR_API_TOKEN
```

### Q4: 申请失败如何调试？

使用 `--no-cleanup` 保留 DNS 记录：

```bash
npx auto-cert issue \
  -d "*.clawcave.rockicat.com" \
  -t dns-01 \
  --dns-provider cloudflare \
  --dns-token YOUR_API_TOKEN \
  --no-cleanup
```

然后：
1. 登录 Cloudflare 控制台查看 DNS 记录
2. 手动验证 DNS 记录：
   ```bash
   dig TXT _acme-challenge.clawcave.rockicat.com
   ```
3. 检查 Let's Encrypt 日志（使用 `--staging` 参数测试）

## 安全建议

1. **保护 API Token**
   - 不要在代码或日志中暴露 Token
   - 使用环境变量或密钥管理工具
   - 定期轮换 Token

2. **最小权限原则**
   - Cloudflare Token 只授予必要的权限
   - 使用 Zone 级别限制，不要使用全局权限

3. **测试环境验证**
   - 首次使用先用 `--staging` 测试
   - 避免触发 Let's Encrypt 速率限制

4. **监控证书有效期**
   - 定期检查证书状态
   - 设置自动续期

## 相关文档

- [Let's Encrypt 通配符证书文档](https://letsencrypt.org/docs/certificates-for-subdomains/)
- [Cloudflare API Token 文档](https://api.cloudflare.com/)
- [ACME 协议 RFC 8555](https://tools.ietf.org/html/rfc8555)
