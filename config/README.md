# Config 目录

本目录用于存放 auto-cert 的配置文件。

## 目录作用

`config/` 目录包含 auto-cert 运行所需的全部配置信息：

- **主配置** (`config.yaml`) - ACME 账户、验证方式、nginx 路径等
- **域名配置** (`domains.yaml`) - 已管理的域名列表及独立配置（含 SSH 远程配置）
- **账户密钥** (`accounts/`) - Let's Encrypt 账户私钥（敏感）

## 文件说明

### config.yaml

主配置文件，包含全局设置：

```yaml
# 联系邮箱（必需）
email: admin@example.com

# 是否使用 Let's Encrypt 测试环境
staging: false

# HTTP-01 验证的根目录
webRoot: /var/www/html

# 默认验证方式: http-01 或 dns-01
challengeType: http-01

# nginx 配置目录
nginxConfDir: /etc/nginx/conf.d
nginxSitesDir: /etc/nginx/sites-enabled

# 日志级别: debug/info/warn/error
logLevel: info

# DNS 配置（使用 DNS-01 验证时需要）
dnsProvider: cloudflare
dnsCredentials:
  apiToken: your-api-token
```

**生成方式**：
```bash
# 交互式配置
npm run setup

# 或快速创建默认配置
npm run config:init
```

### domains.yaml

域名记录文件，支持**本地模式**和**SSH 远程模式**：

#### 本地模式（默认）

```yaml
example.com:
  issuedAt: '2026-02-04T10:00:00.000Z'     # 证书签发时间（自动更新）
  email: admin@example.com                 # 申请时使用的邮箱
  webRoot: /var/www/example-com            # 该域名的独立 webRoot（可选）
```

#### SSH 远程模式

```yaml
remote.example.com:
  issuedAt: '2026-02-04T10:00:00.000Z'
  email: admin@example.com
  # webRoot: /var/www/html                # SSH 模式下可不设置，使用 ssh.remoteWebRoot
  
  # SSH 远程配置
  ssh:
    host: remote.example.com               # 远程服务器地址
    port: 22                               # SSH 端口（默认 22）
    username: root                         # 登录用户名
    privateKey: ~/.ssh/id_rsa              # 私钥路径（默认 ~/.ssh/id_rsa）
    # 或 password: xxxxxx                  # 密码登录（不推荐）
    
    # 远程路径配置
    remoteWebRoot: /var/www/html           # 远程 web 根目录（HTTP-01 验证用）
    remoteNginxConfDir: /etc/nginx/conf.d  # 远程 nginx 配置目录（deploy 必需，用于上传配置文件）
    remoteCertsDir: /opt/auto-cert/certs   # 远程证书存放目录（格式: cert.pem + cert.key）
```

**SSH 模式工作流程**：

```
1. 本地运行 auto-cert
2. 通过 SSH 连接到远程服务器
3. 在远程服务器上创建验证文件（HTTP-01）
4. 等待 Let's Encrypt 验证
5. 下载证书到本地
6. 上传证书到远程服务器
7. 生成并上传 nginx 配置
8. 远程重载 nginx
```

**生成方式**：
```bash
# 添加本地域名
npm run domain:add -- example.com

# 添加带独立 webRoot 的域名
npm run domain:add -- example.com /var/www/example-com

# SSH 远程域名需要手动编辑 domains.yaml 添加 ssh 配置
```

### domains.yaml 配置优先级

| 优先级 | 来源 | 说明 |
|--------|------|------|
| 1 | 命令行 `--webroot` | 临时覆盖 |
| 2 | domains.yaml `webRoot` | 该域名的独立配置 |
| 3 | config.yaml `webRoot` | 全局默认值 |
| 4 | 内置默认值 | `/var/www/html` |

**SSH 远程模式优先级**：
- 如果配置了 `ssh`，优先使用 `ssh.remoteWebRoot`
- 如果未配置 `ssh.remoteWebRoot`，使用普通优先级

## 文件规范

### 格式

- 所有配置文件使用 **YAML** 格式
- 文件编码：UTF-8
- 缩进：2 个空格

### 命名规范

| 文件 | 必需 | 说明 |
|------|------|------|
| `config.yaml` | 是 | 主配置文件 |
| `domains.yaml` | 否 | 自动创建/更新 |
| `accounts/*.pem` | 是 | 首次运行时自动生成 |

### 配置优先级（全局）

1. 命令行参数（如 `--email`, `--staging`, `--webroot`）
2. 环境变量（如 `AUTO_CERT_EMAIL`）
3. 配置文件（`config.yaml` / `domains.yaml`）
4. 默认值

## 安全须知

⚠️ **本目录包含敏感信息**：

- `config.yaml` - 包含邮箱地址
- `domains.yaml` - 包含域名列表，**SSH 配置包含服务器登录信息**
- `accounts/*.pem` - ACME 账户私钥

**已添加到 `.gitignore`**：
```gitignore
config/*.yaml
config/*.yml
config/accounts/
```

请勿手动将这些文件提交到 Git 仓库！

### SSH 密钥安全

如果使用 SSH 远程模式：
- 使用私钥登录（推荐）
- 私钥文件权限应设置为 `600`
- 不要在 `domains.yaml` 中硬编码密码
- 考虑使用 SSH agent 管理密钥

## 备份建议

建议定期备份以下文件（不含 accounts/）：

```bash
# 备份配置（排除密钥）
tar czf auto-cert-config-backup.tar.gz \
  config/config.yaml \
  config/domains.yaml

# 恢复配置
tar xzf auto-cert-config-backup.tar.gz
```

如需迁移到新服务器，只需：
1. 备份 `config/` 目录（不含 `accounts/`）
2. 在新服务器运行 `npm run setup` 重新生成账户密钥
3. 恢复配置文件

## 常见问题

### Q: 可以手动编辑这些文件吗？

可以。YAML 文件是纯文本，可直接编辑：

```bash
vim config/config.yaml
```

编辑后建议验证语法：
```bash
node -e "console.log(require('js-yaml').load(require('fs').readFileSync('config/config.yaml')))"
```

### Q: 如何重置配置？

```bash
# 删除配置文件
rm config/config.yaml config/domains.yaml

# 重新初始化
npm run setup
```

### Q: 多个域名可以共用同一个邮箱吗？

可以。`config.yaml` 中的 `email` 是默认值，所有域名默认使用此邮箱。

如需为特定域名使用不同邮箱，申请时指定：
```bash
npm run cert:issue -- --domain example.com --email other@example.com
```

### Q: SSH 远程模式需要哪些前提条件？

1. 本地可以通过 SSH 登录远程服务器
2. 远程服务器已安装 nginx
3. 远程服务器 80 端口可访问（HTTP-01 验证）
4. 远程服务器有写入 nginx 配置目录的权限

测试 SSH 连接：
```bash
ssh -i ~/.ssh/id_rsa root@remote.example.com "echo '连接成功'"
```

### Q: SSH 模式和本地模式的区别？

| 特性 | 本地模式 | SSH 远程模式 |
|------|----------|--------------|
| 验证文件位置 | 本地文件系统 | 远程服务器 |
| nginx 配置位置 | 本地 | 远程服务器 |
| 证书存储位置 | 本地 `certs/` | 本地 + 远程 |
| 适用场景 | 单服务器 | 多服务器/跳板机 |
