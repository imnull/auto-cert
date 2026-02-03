---
name: nodejs-master
description: Node.js 开发大师与 Git 专家，专注于 HTTPS 证书自动化管理。在需要构建 Node.js CLI 工具、实现 ACME 协议证书申请/续期、生成 nginx SSL 配置、或进行服务器部署时使用。涵盖 Let's Encrypt/ZeroSSL 证书全生命周期管理、nginx 最佳实践、以及通过 Git 自动化部署到服务器的完整工作流。
---

# Node.js Master

Node.js 开发大师，Git 专家，HTTPS 证书自动化管理专家。

## 核心能力

1. **Node.js CLI 开发** - 构建命令行工具，实现证书管理功能
2. **ACME 协议实现** - 支持 Let's Encrypt / ZeroSSL 证书申请与续期
3. **nginx 配置管理** - 生成符合最佳实践的 SSL 配置
4. **Git 部署工作流** - 通过 Git 将项目部署到服务器并执行操作

## 快速开始

### 项目初始化

创建新的证书管理项目：

```bash
# 初始化项目
npm init -y

# 安装核心依赖
npm install acme-client commander chalk

# 安装开发依赖
npm install --save-dev eslint prettier
```

### 目录结构标准

```
auto-cert/
├── bin/                    # CLI 入口
│   └── auto-cert.js
├── lib/                    # 核心逻辑
│   ├── acme.js            # ACME 客户端封装
│   ├── dns.js             # DNS 验证处理
│   ├── nginx.js           # nginx 配置生成
│   └── deploy.js          # 部署逻辑
├── config/                 # 配置文件
│   └── domains.json
├── certs/                  # 证书存储（gitignored）
├── scripts/               # npm 脚本辅助
│   └── post-install.js
├── package.json
└── README.md
```

### npm 脚本标准

```json
{
  "scripts": {
    "cert:issue": "node bin/auto-cert.js issue",
    "cert:renew": "node bin/auto-cert.js renew",
    "cert:deploy": "node bin/auto-cert.js deploy",
    "setup": "node scripts/post-install.js",
    "lint": "eslint lib/ bin/",
    "test": "jest"
  }
}
```

## 证书管理实现指南

### 1. ACME 客户端封装

使用 `acme-client` 库实现证书申请：

```javascript
const acme = require('acme-client');

class AcmeCertManager {
  constructor(options) {
    this.directoryUrl = options.staging 
      ? acme.directory.letsencrypt.staging
      : acme.directory.letsencrypt.production;
    this.accountKey = null;
    this.client = null;
  }

  async initialize() {
    // 生成账户密钥
    this.accountKey = await acme.forge.createPrivateKey();
    this.client = new acme.Client({
      directoryUrl: this.directoryUrl,
      accountKey: this.accountKey
    });
  }

  async orderCertificate(domain, challengeHandler) {
    const order = await this.client.createOrder({
      identifiers: [{ type: 'dns', value: domain }]
    });

    const authorizations = await this.client.getAuthorizations(order);
    
    for (const authz of authorizations) {
      const challenge = authz.challenges.find(
        c => c.type === 'dns-01' || c.type === 'http-01'
      );
      
      // 完成验证挑战
      await challengeHandler(challenge, authz);
      await this.client.completeChallenge(challenge);
      await this.client.waitForValidStatus(challenge);
    }

    // 生成 CSR 并获取证书
    const [key, csr] = await acme.forge.createCsr({
      commonName: domain
    });

    const cert = await this.client.finalizeOrder(order, csr);
    return { key, cert };
  }
}
```

### 2. DNS 验证实现

支持常见 DNS 服务商的自动验证：

```javascript
// lib/dns.js
class DnsChallengeHandler {
  constructor(provider) {
    this.provider = provider; // 'cloudflare', 'aliyun', 'aws'
  }

  async addRecord(domain, recordName, recordContent) {
    // 根据 provider 添加 TXT 记录
    switch (this.provider) {
      case 'cloudflare':
        return this.addCloudflareRecord(domain, recordName, recordContent);
      case 'aliyun':
        return this.addAliyunRecord(domain, recordName, recordContent);
      default:
        throw new Error(`Unsupported DNS provider: ${this.provider}`);
    }
  }

  async removeRecord(domain, recordName) {
    // 清理 TXT 记录
  }
}
```

### 3. HTTP 验证实现

```javascript
// lib/http-challenge.js
const http = require('http');
const path = require('path');
const fs = require('fs').promises;

class HttpChallengeServer {
  constructor(webRoot = '/var/www/html') {
    this.webRoot = webRoot;
    this.server = null;
  }

  async start() {
    this.server = http.createServer(async (req, res) => {
      const match = req.url.match(/^\/\.well-known\/acme-challenge\/(.*)$/);
      if (match) {
        const token = match[1];
        const filePath = path.join(this.webRoot, '.well-known', 'acme-challenge', token);
        try {
          const content = await fs.readFile(filePath, 'utf8');
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end(content);
        } catch (err) {
          res.writeHead(404);
          res.end('Not found');
        }
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    return new Promise((resolve) => {
      this.server.listen(80, () => {
        console.log('HTTP challenge server started on port 80');
        resolve();
      });
    });
  }

  async prepareChallenge(token, keyAuthorization) {
    const challengeDir = path.join(this.webRoot, '.well-known', 'acme-challenge');
    await fs.mkdir(challengeDir, { recursive: true });
    await fs.writeFile(path.join(challengeDir, token), keyAuthorization);
  }

  stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(resolve);
      } else {
        resolve();
      }
    });
  }
}
```

### 4. nginx 配置生成

```javascript
// lib/nginx.js
const fs = require('fs').promises;
const path = require('path');

class NginxConfigGenerator {
  constructor(options = {}) {
    this.certPath = options.certPath || '/etc/nginx/ssl';
    this.nginxPath = options.nginxPath || '/etc/nginx/conf.d';
  }

  generate(domain, certFiles) {
    return `
server {
    listen 80;
    server_name ${domain};
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name ${domain};

    # SSL 证书配置
    ssl_certificate ${certFiles.fullchain};
    ssl_certificate_key ${certFiles.privateKey};

    # SSL 安全最佳实践
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;
    ssl_session_tickets off;

    # OCSP Stapling
    ssl_stapling on;
    ssl_stapling_verify on;
    ssl_trusted_certificate ${certFiles.chain};

    # Security headers
    add_header Strict-Transport-Security "max-age=63072000" always;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # ACME challenge
    location /.well-known/acme-challenge/ {
        alias /var/www/html/.well-known/acme-challenge/;
    }
}
`;
  }

  async write(domain, content) {
    const filePath = path.join(this.nginxPath, `${domain}.conf`);
    await fs.writeFile(filePath, content, 'utf8');
    return filePath;
  }
}
```

## Git 部署工作流

### 服务器端 Git Hook 设置

```bash
# 在服务器上创建裸仓库
git init --bare auto-cert.git

# 创建 post-receive hook
cat > auto-cert.git/hooks/post-receive << 'EOF'
#!/bin/bash
TARGET="/opt/auto-cert"
GIT_DIR="/home/git/auto-cert.git"
BRANCH="main"

while read oldrev newrev ref
do
    if [[ $ref = refs/heads/$BRANCH ]]; then
        echo "Deploying $BRANCH to production..."
        git --work-tree=$TARGET --git-dir=$GIT_DIR checkout -f $BRANCH
        cd $TARGET
        npm install --production
        echo "Deployment complete!"
    fi
done
EOF

chmod +x auto-cert.git/hooks/post-receive
```

### 本地部署配置

```bash
# 添加远程仓库
git remote add production git@server:/home/git/auto-cert.git

# 部署
git push production main
```

## 服务器端操作

### SSH 执行远程命令

```javascript
// lib/ssh.js
const { Client } = require('ssh2');

class SshExecutor {
  constructor(config) {
    this.config = config;
  }

  async execute(command) {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      let stdout = '';
      let stderr = '';

      conn.on('ready', () => {
        conn.exec(command, (err, stream) => {
          if (err) return reject(err);
          
          stream.on('close', (code) => {
            conn.end();
            resolve({ code, stdout, stderr });
          });
          
          stream.on('data', (data) => {
            stdout += data;
          });
          
          stream.stderr.on('data', (data) => {
            stderr += data;
          });
        });
      }).connect(this.config);
    });
  }

  async reloadNginx() {
    const result = await this.execute('sudo nginx -t && sudo nginx -s reload');
    if (result.code !== 0) {
      throw new Error(`nginx reload failed: ${result.stderr}`);
    }
    return result;
  }
}
```

## 参考文档

- **ACME 协议详解**: [references/acme-protocol.md](references/acme-protocol.md)
- **nginx SSL 最佳实践**: [references/nginx-ssl-best-practices.md](references/nginx-ssl-best-practices.md)
- **Let's Encrypt 指南**: [references/letsencrypt-guide.md](references/letsencrypt-guide.md)

## 使用示例

### 完整证书申请流程

```javascript
const AutoCert = require('./lib');

const certManager = new AutoCert({
  email: 'admin@example.com',
  staging: false,
  dnsProvider: 'cloudflare',
  dnsCredentials: {
    apiToken: process.env.CF_API_TOKEN
  }
});

async function main() {
  // 申请证书
  const result = await certManager.issue('example.com');
  console.log('Certificate issued:', result.certPath);
  
  // 生成 nginx 配置
  await certManager.generateNginxConfig('example.com');
  
  // 部署并 reload nginx
  await certManager.deploy();
}

main().catch(console.error);
```

### 证书续期检查

```javascript
// 检查证书有效期，小于 30 天时自动续期
await certManager.renewIfNeeded('example.com', { daysBeforeExpiry: 30 });
```
