/**
 * nginx 管理模块
 * 处理配置生成、部署、重载等操作
 */

const fs = require('fs').promises;
const path = require('path');
const { exec, execSync } = require('child_process');
const util = require('util');

const execAsync = util.promisify(exec);

class NginxManager {
  constructor(config) {
    this.config = config;
  }

  /**
   * 生成 nginx 配置
   */
  generateConfig(options) {
    const {
      domain,
      upstream = 'localhost',
      upstreamPort = 3000,
      webRoot = this.config.webRoot,
      enableHttp2 = true,
      enableHsts = true,
      customLocations = []
    } = options;

    const certPaths = this.config.getCertPaths(domain);

    // SSL 配置块
    const sslConfig = `
    # SSL 证书
    ssl_certificate ${certPaths.fullchain};
    ssl_certificate_key ${certPaths.privateKey};
    ssl_trusted_certificate ${certPaths.chain};

    # SSL 协议与加密套件
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;

    # Session 配置
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:50m;
    ssl_session_tickets off;

    # OCSP Stapling
    ssl_stapling on;
    ssl_stapling_verify on;
    resolver 8.8.8.8 8.8.4.4 1.1.1.1 valid=300s;
    resolver_timeout 5s;

    # 安全响应头
    ${enableHsts ? 'add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;' : ''}
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
`;

    // HTTP 服务器块（重定向到 HTTPS）
    const httpBlock = `
server {
    listen 80;
    listen [::]:80;
    server_name ${domain};
    
    # ACME 挑战
    location /.well-known/acme-challenge/ {
        alias ${webRoot}/.well-known/acme-challenge/;
    }
    
    location / {
        return 301 https://$server_name$request_uri;
    }
}
`;

    // 构建 location 配置
    let locationConfig = '';
    
    // 添加自定义 locations
    if (customLocations.length > 0) {
      for (const loc of customLocations) {
        locationConfig += `
    location ${loc.path} {
        ${loc.directives.join('\n        ')}
    }`;
      }
    }

    // 默认反向代理
    locationConfig += `
    location / {
        proxy_pass http://${upstream}:${upstreamPort};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
`;

    // HTTPS 服务器块
    const httpsBlock = `
server {
    listen 443 ssl${enableHttp2 ? ' http2' : ''};
    listen [::]:443 ssl${enableHttp2 ? ' http2' : ''};
    server_name ${domain};

${sslConfig}
${locationConfig}
}
`;

    return (httpBlock + httpsBlock).trim();
  }

  /**
   * 部署证书和配置到 nginx
   */
  async deploy(domain, options = {}) {
    const config = this.generateConfig({
      domain,
      upstream: options.upstream,
      upstreamPort: options.upstreamPort,
      webRoot: options.webRoot
    });

    // 写入配置文件
    const configPath = path.join(
      options.nginxConfDir || this.config.nginxConfDir,
      `${domain}.conf`
    );

    // 备份现有配置
    if (options.backup !== false) {
      await this.backupConfig(configPath);
    }

    await fs.writeFile(configPath, config, 'utf8');

    // 测试配置
    if (!(await this.testConfig())) {
      // 测试失败，恢复备份
      await this.restoreBackup(configPath);
      throw new Error('nginx 配置测试失败');
    }

    // 重载 nginx
    if (options.reload !== false) {
      await this.reload();
    }

    return { configPath };
  }

  /**
   * 备份配置文件
   */
  async backupConfig(configPath) {
    try {
      await fs.access(configPath);
      const backupPath = `${configPath}.backup.${Date.now()}`;
      await fs.copyFile(configPath, backupPath);
      return backupPath;
    } catch (err) {
      // 原配置不存在，无需备份
      return null;
    }
  }

  /**
   * 恢复备份
   */
  async restoreBackup(configPath) {
    const backupPattern = `${configPath}.backup.*`;
    try {
      const { stdout } = await execAsync(`ls -t ${backupPattern} | head -1`);
      const backupPath = stdout.trim();
      if (backupPath) {
        await fs.copyFile(backupPath, configPath);
        return backupPath;
      }
    } catch (err) {
      // 没有备份
    }
    return null;
  }

  /**
   * 测试 nginx 配置
   */
  async testConfig() {
    try {
      await execAsync('nginx -t');
      return true;
    } catch (err) {
      return false;
    }
  }

  /**
   * 重载 nginx
   */
  async reload() {
    try {
      await execAsync('nginx -s reload');
      return true;
    } catch (err) {
      throw new Error(`nginx 重载失败: ${err.message}`);
    }
  }

  /**
   * 生成并输出配置（不写入文件）
   */
  async generate(domain, options = {}) {
    return this.generateConfig({
      domain,
      ...options
    });
  }
}

module.exports = NginxManager;
