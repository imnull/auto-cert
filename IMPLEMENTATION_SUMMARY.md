# DNS-01 验证和通配符证书更新总结

## 本次更新内容

### ✅ 已实现功能

1. **Cloudflare DNS API 客户端**
   - 文件：`lib/challenges/dns-providers/cloudflare.js`
   - 功能：
     - 自动查找 Zone ID
     - 添加 DNS TXT 记录
     - 删除 DNS TXT 记录
     - 等待 DNS 传播（使用 Google Public DNS 验证）
   - 支持两种认证方式：
     - API Token（推荐）
     - Global API Key + Email

2. **完善 DNS-01 验证处理器**
   - 文件：`lib/challenges/dns-01.js`
   - 更新：
     - 集成 Cloudflare 客户端
     - 自动跟踪创建的 DNS 记录
     - 验证完成后自动清理
     - 详细的日志输出

3. **certificate.js 支持本地模式**
   - 文件：`lib/certificate.js`
   - 新增：
     - `issueLocal()` 方法支持本地申请（不需要 SSH）
     - 通配符证书自动强制使用 DNS-01 验证
     - 支持多域名 SAN 证书（逗号分隔）
   - 优化：
     - 根据验证类型自动选择本地/远程模式
     - DNS-01 验证本地执行，HTTP-01 仍需 SSH

4. **CLI 命令行参数增强**
   - 文件：`bin/auto-cert.js`
   - 新增参数：
     - `--dns-token` - DNS API Token
     - `--dns-key` - DNS API Key（Cloudflare Global Key）
     - `--dns-email` - DNS 服务商邮箱
   - 更新域名参数说明：支持通配符

5. **文档更新**
   - README.md 添加通配符证书示例
   - 新增 `docs/wildcard-certificate-guide.md` 详细使用指南

## 使用示例

### 申请通配符证书

```bash
npx auto-cert issue \
  -d "*.clawcave.rockicat.com" \
  -t dns-01 \
  --dns-provider cloudflare \
  --dns-token YOUR_CLOUDFLARE_API_TOKEN \
  --email your-email@example.com
```

### 申请测试证书

```bash
npx auto-cert issue \
  -d "*.clawcave.rockicat.com" \
  -t dns-01 \
  --dns-provider cloudflare \
  --dns-token YOUR_API_TOKEN \
  --email your-email@example.com \
  --staging
```

### 申请多域名 SAN 证书

```bash
npx auto-cert issue \
  -d "clawcave.rockicat.com,*.clawcave.rockicat.com" \
  -t dns-01 \
  --dns-provider cloudflare \
  --dns-token YOUR_API_TOKEN \
  --email your-email@example.com
```

## 工作流程

```
用户执行申请命令
    ↓
创建 ACME 订单（Let's Encrypt）
    ↓
获取 DNS 挑战（_acme-challenge.{domain} TXT 记录）
    ↓
调用 Cloudflare API 添加 TXT 记录
    ↓
等待 DNS 传播（自动检测，约 30-60 秒）
    ↓
Let's Encrypt 验证 DNS 记录
    ↓
验证通过 → 下载证书
    ↓
保存证书到本地（certs/ 目录）
    ↓
自动清理 DNS 记录
    ↓
完成
```

## 技术亮点

1. **自动模式选择**
   - DNS-01 验证：本地执行，不需要 SSH
   - HTTP-01 验证：仍需 SSH 远程模式

2. **智能 DNS 传播检测**
   - 使用 Google Public DNS API 验证
   - 自动重试，最长等待 50 秒

3. **自动清理**
   - 验证成功后自动删除 DNS 记录
   - 失败时保留记录便于调试

4. **多域名支持**
   - 逗号分隔多个域名
   - 自动创建 SAN 证书

## 待实现功能

- [ ] 阿里云 DNS 支持
- [ ] AWS Route53 支持
- [ ] 手动 DNS 验证模式（输出记录让用户手动添加）
- [ ] 证书到期自动续期（cron 集成）

## 注意事项

1. **通配符证书限制**
   - 只能保护一级子域名
   - `*.example.com` ✅ 保护 `a.example.com`
   - `*.*.example.com` ❌ 不支持

2. **Cloudflare API 权限**
   - Zone → DNS → Edit
   - Zone → Zone → Read

3. **Let's Encrypt 速率限制**
   - 每周每域名最多 50 个证书
   - 建议先用 `--staging` 测试
