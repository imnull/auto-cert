# Config 目录

本目录用于存放 auto-cert 的配置文件。

## 目录作用

`config/` 目录包含 auto-cert 运行所需的全部配置信息：

- **主配置** (`config.yaml`) - ACME 账户、验证方式、nginx 路径等
- **域名配置** (`domains.yaml`) - 已管理的域名列表及元数据
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

域名记录文件，记录已管理的域名及其独立配置：

```yaml
example.com:
  issuedAt: '2026-02-04T10:00:00.000Z'     # 记录创建时间
  email: admin@example.com                 # 申请时使用的邮箱
  webRoot: /var/www/example-com            # 该域名的独立 webRoot（可选）

www.example.com:
  issuedAt: '2026-02-04T10:30:00.000Z'
  email: admin@example.com
  webRoot: /var/www/www-example-com        # 每个域名可有不同的 webRoot
```

**配置优先级**：
1. 命令行参数 `--webroot`
2. 域名配置中的 `webRoot`（domains.yaml）
3. 全局配置中的 `webRoot`（config.yaml）
4. 默认值 `/var/www/html`

**生成方式**：
```bash
# 快速添加域名记录
npm run domain:add -- example.com

# 申请证书时自动更新
npm run cert:issue -- --domain example.com
```

### accounts/

存储 Let's Encrypt ACME 账户私钥：

```
accounts/
├── admin_example_com_prod.pem    # 生产环境账户
└── admin_example_com_staging.pem # 测试环境账户
```

⚠️ **重要**：此目录包含敏感密钥文件，已添加到 `.gitignore`，请勿提交到版本控制。

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

### 优先级

配置优先级（从高到低）：

1. 命令行参数（如 `--email`, `--staging`）
2. 环境变量（如 `AUTO_CERT_EMAIL`）
3. 配置文件（`config.yaml`）
4. 默认值

## 安全须知

⚠️ **本目录包含敏感信息**：

- `config.yaml` - 包含邮箱地址
- `domains.yaml` - 包含域名列表
- `accounts/*.pem` - ACME 账户私钥

**已添加到 `.gitignore`**：
```gitignore
config/*.yaml
config/*.yml
config/accounts/
```

请勿手动将这些文件提交到 Git 仓库！

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
