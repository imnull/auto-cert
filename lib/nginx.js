/**
 * nginx 管理模块
 * 处理配置生成、部署、重载等操作
 * 支持本地模式和 SSH 远程模式
 */

const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
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
      customLocations = [],
      skipHttpRedirect = false  // 如果用户已有 HTTP 配置，跳过 80 端口重定向
    } = options;

    // 判断是否为远程模式（通过 options 中的 remoteCertsDir）
    const isRemote = !!options.remoteCertsDir;
    const certDir = isRemote 
      ? path.posix.join(options.remoteCertsDir, domain)
      : path.dirname(this.config.getCertPaths(domain).cert);
    
    // SSL 配置块
    const sslConfig = `
    # SSL 证书
    ssl_certificate ${path.posix.join(certDir, 'cert.pem')};
    ssl_certificate_key ${path.posix.join(certDir, 'cert.key')};
    ${isRemote ? '' : `ssl_trusted_certificate ${path.posix.join(certDir, 'chain.pem')};`}

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

    // HTTP 服务器块（80 端口）
    let httpBlock = '';
    if (!skipHttpRedirect) {
      httpBlock = `
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
    }

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
   * 检查现有配置
   */
  async checkExistingConfig(configPath) {
    try {
      const content = await fs.readFile(configPath, 'utf8');
      const hasHttp = content.includes('listen 80');
      const hasHttps = content.includes('listen 443') || content.includes('ssl_certificate');
      return { exists: true, hasHttp, hasHttps, content };
    } catch (err) {
      return { exists: false, hasHttp: false, hasHttps: false, content: '' };
    }
  }

  /**
   * 部署证书和配置
   */
  async deploy(domain, options = {}) {
    const { sshClient } = options;

    if (sshClient) {
      // SSH 远程模式
      return this.deployRemote(domain, options, sshClient);
    }

    // 本地模式
    return this.deployLocal(domain, options);
  }

  /**
   * 本地部署
   */
  async deployLocal(domain, options = {}) {
    const nginxConfDir = options.nginxConfDir || this.config.nginxConfDir;
    const defaultConfigPath = path.join(nginxConfDir, `${domain}.conf`);
    const httpsConfigPath = path.join(nginxConfDir, `${domain}-https.conf`);

    // 确保 nginx 配置目录存在
    await fs.mkdir(nginxConfDir, { recursive: true });

    // 检查现有配置
    const existing = await this.checkExistingConfig(defaultConfigPath);
    let targetConfigPath = defaultConfigPath;
    let skipHttpRedirect = false;

    if (existing.exists) {
      console.log(`  检测到现有配置: ${defaultConfigPath}`);
      
      if (existing.hasHttps) {
        // 已有 HTTPS 配置，备份并覆盖
        console.log('  现有配置包含 HTTPS，将备份并覆盖');
        if (options.backup !== false) {
          const backupPath = await this.backupConfig(defaultConfigPath);
          if (backupPath) {
            console.log(`  已备份到: ${backupPath}`);
          }
        }
      } else if (existing.hasHttp) {
        // 只有 HTTP 配置，创建独立的 HTTPS 配置文件
        console.log('  现有配置仅包含 HTTP，将创建独立的 HTTPS 配置');
        targetConfigPath = httpsConfigPath;
        skipHttpRedirect = true;
        console.log(`  HTTPS 配置将保存到: ${targetConfigPath}`);
      }
    }

    // 生成配置
    const config = this.generateConfig({
      domain,
      upstream: options.upstream,
      upstreamPort: options.upstreamPort,
      webRoot: options.webRoot,
      skipHttpRedirect
    });

    // 写入配置文件
    await fs.writeFile(targetConfigPath, config, 'utf8');
    console.log(`  配置已写入: ${targetConfigPath}`);

    // 测试配置
    console.log('  测试 nginx 配置...');
    if (!(await this.testConfig())) {
      // 测试失败，恢复备份
      if (existing.exists && options.backup !== false) {
        console.log('  配置测试失败，尝试恢复备份...');
        await this.restoreBackup(defaultConfigPath);
      }
      throw new Error('nginx 配置测试失败');
    }

    // 重载 nginx
    if (options.reload !== false) {
      console.log('  重载 nginx...');
      await this.reload();
    }

    return { configPath: targetConfigPath };
  }

  /**
   * 远程部署（SSH 模式）
   */
  async deployRemote(domain, options, sshClient) {
    const remoteNginxConfDir = options.nginxConfDir || '/etc/nginx/conf.d';
    const remoteWebRoot = options.webRoot || '/var/www/html';
    const remoteCertsDir = options.remoteCertsDir || '/opt/auto-cert/certs';

    const defaultConfigPath = path.posix.join(remoteNginxConfDir, `${domain}.conf`);
    const httpsConfigPath = path.posix.join(remoteNginxConfDir, `${domain}-https.conf`);

    // 确保远程 nginx 配置目录存在
    await sshClient.mkdir(remoteNginxConfDir);

    // 检查远程现有配置
    const existing = await sshClient.exists(defaultConfigPath);
    let targetConfigPath = defaultConfigPath;
    let skipHttpRedirect = false;

    if (existing) {
      console.log(`  检测到远程现有配置: ${defaultConfigPath}`);
      const content = await sshClient.readFile(defaultConfigPath);
      const hasHttp = content.includes('listen 80');
      const hasHttps = content.includes('listen 443') || content.includes('ssl_certificate');
      
      if (hasHttps) {
        // 已有 HTTPS 配置，备份
        console.log('  现有配置包含 HTTPS，将备份');
        const backupPath = `${defaultConfigPath}.backup.${Date.now()}`;
        await sshClient.exec(`cp ${defaultConfigPath} ${backupPath}`);
        console.log(`  已备份到: ${backupPath}`);
      } else if (hasHttp) {
        // 只有 HTTP 配置，创建独立的 HTTPS 配置文件
        console.log('  现有配置仅包含 HTTP，将创建独立的 HTTPS 配置');
        targetConfigPath = httpsConfigPath;
        skipHttpRedirect = true;
        console.log(`  HTTPS 配置将保存到: ${targetConfigPath}`);
      }
    }

    // 生成配置
    const config = this.generateConfig({
      domain,
      upstream: options.upstream || 'localhost',
      upstreamPort: options.upstreamPort || 3000,
      webRoot: remoteWebRoot,
      remoteCertsDir,
      skipHttpRedirect
    });

    console.log(`  上传 nginx 配置...`);
    await sshClient.writeFile(targetConfigPath, config);
    console.log(`  配置已上传: ${targetConfigPath}`);

    // 测试远程 nginx 配置
    console.log('  测试远程 nginx 配置...');
    if (!(await sshClient.testNginx())) {
      throw new Error('远程 nginx 配置测试失败');
    }

    // 重载远程 nginx
    if (options.reload !== false) {
      console.log('  重载远程 nginx...');
      await sshClient.reloadNginx();
    }

    return { configPath: targetConfigPath };
  }

  /**
   * 备份配置文件
   */
  async backupConfig(configPath) {
    try {
      await fs.access(configPath);
      const backupPath = `${configPath}.backup.${Date.now()}`;
      await fs.copyFile(configPath, backupPath);
      console.log(`  已备份原配置: ${backupPath}`);
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
