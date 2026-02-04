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

## SSL 配置

生成的 nginx 配置包含以下安全特性：

- **TLS 1.2 / TLS 1.3** 协议
- **强加密套件**（前向安全）
- **HSTS**（HTTP Strict Transport Security）
- **OCSP Stapling**
- **安全响应头**（X-Frame-Options, X-Content-Type-Options 等）

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

## 注意事项

1. **权限**：
   - 证书目录需要适当权限（私钥 `600`，证书 `644`）
   - nginx 配置目录可能需要 root 权限

2. **端口**：
   - HTTP-01 验证需要服务器 80 端口可访问
   - 或使用 DNS-01 验证（需要 DNS 服务商 API）

3. **测试环境**：
   - 开发测试时添加 `--staging` 参数
   - 避免触发生产环境速率限制

## 许可证

MIT
