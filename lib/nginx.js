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
   * 生成 SSL 配置片段
   */
  generateSslConfig(certDir, isRemote) {
    return `
    # SSL 证书
    ssl_certificate ${path.posix.join(certDir, 'fullchain.pem')};
    ssl_certificate_key ${path.posix.join(certDir, 'privkey.pem')};

    # SSL 协议与加密套件
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;

    # Session 配置
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:50m;
    ssl_session_tickets off;

    # 安全响应头
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
`;
  }

  /**
   * 生成完整 nginx 配置（新站点）
   */
  generateConfig(options) {
    const {
      domain,
      upstream = 'localhost',
      upstreamPort = 3000,
      webRoot = this.config.webRoot,
      enableHttp2 = true
    } = options;

    const isRemote = !!options.remoteCertsDir;
    const certDir = isRemote 
      ? path.posix.join(options.remoteCertsDir, domain)
      : path.dirname(this.config.getCertPaths(domain).cert);

    const sslConfig = this.generateSslConfig(certDir, isRemote);

    return `
server {
    listen 80;
    listen [::]:80;
    server_name ${domain};
    
    location /.well-known/acme-challenge/ {
        alias ${webRoot}/.well-known/acme-challenge/;
    }
    
    location / {
        return 301 https://$server_name$request_uri;
    }
}

server {
    listen 443 ssl${enableHttp2 ? ' http2' : ''};
    listen [::]:443 ssl${enableHttp2 ? ' http2' : ''};
    server_name ${domain};
${sslConfig}
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
}
`.trim();
  }

  /**
   * 基于现有 HTTP 配置添加 HTTPS
   */
  transformHttpToHttps(content, domain, certDir, enableHttp2 = true) {
    // 提取 server 块
    const serverBlocks = this.parseServerBlocks(content);
    
    if (serverBlocks.length === 0) {
      throw new Error('无法解析现有 nginx 配置');
    }

    let transformed = [];
    let hasAddedHttps = false;

    for (const block of serverBlocks) {
      // 检查是否已有 HTTPS
      if (block.includes('listen 443') || block.includes('ssl_certificate')) {
        // 已有 HTTPS，保留原样
        transformed.push(block);
        hasAddedHttps = true;
        continue;
      }

      // 处理 HTTP server 块
      if (block.includes('listen 80')) {
        // 保留原始 HTTP 配置，添加 ACME 路径
        let httpBlock = block;
        
        // 如果还没有 .well-known 路径，添加一个
        if (!block.includes('.well-known/acme-challenge')) {
          // 在最后一个 location 或 server 块结束前插入
          httpBlock = block.replace(
            /(server\s*{[\s\S]*?)(})/,
            `$1    location /.well-known/acme-challenge/ {
        alias /var/www/html/.well-known/acme-challenge/;
    }

$2`
          );
        }
        
        transformed.push(httpBlock);

        // 创建对应的 HTTPS server 块
        const httpsBlock = this.createHttpsServerFromHttp(block, domain, certDir, enableHttp2);
        transformed.push(httpsBlock);
        hasAddedHttps = true;
      } else {
        // 其他 server 块保持不变
        transformed.push(block);
      }
    }

    if (!hasAddedHttps) {
      throw new Error('未找到可转换的 HTTP server 块');
    }

    return transformed.join('\n\n');
  }

  /**
   * 从 HTTP server 块创建 HTTPS server 块
   */
  createHttpsServerFromHttp(httpBlock, domain, certDir, enableHttp2) {
    // 提取 location 配置
    const locationMatches = httpBlock.match(/location\s+[^{]+\{[^}]+\}/g) || [];
    
    // 过滤掉 return 301 和 .well-known（HTTPS 不需要）
    const locations = locationMatches.filter(loc => 
      !loc.includes('return 301') && 
      !loc.includes('.well-known/acme-challenge')
    );

    const sslConfig = this.generateSslConfig(certDir);

    return `server {
    listen 443 ssl${enableHttp2 ? ' http2' : ''};
    listen [::]:443 ssl${enableHttp2 ? ' http2' : ''};
    server_name ${domain};${sslConfig}
${locations.map(l => '    ' + l).join('\n')}
}`;
  }

  /**
   * 解析 nginx server 块
   */
  parseServerBlocks(content) {
    const blocks = [];
    const regex = /server\s*\{([\s\S]*?)\n\}/g;
    let match;
    
    while ((match = regex.exec(content)) !== null) {
      blocks.push('server {' + match[1] + '\n}');
    }
    
    return blocks;
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
      return this.deployRemote(domain, options, sshClient);
    }
    return this.deployLocal(domain, options);
  }

  /**
   * 本地部署
   */
  async deployLocal(domain, options = {}) {
    const nginxConfDir = options.nginxConfDir || this.config.nginxConfDir;
    const configPath = path.join(nginxConfDir, `${domain}.conf`);
    const certDir = path.dirname(this.config.getCertPaths(domain).cert);

    // 确保目录存在
    await fs.mkdir(nginxConfDir, { recursive: true });

    // 检查现有配置
    const existing = await this.checkExistingConfig(configPath);

    if (existing.exists) {
      console.log(`  检测到现有配置: ${configPath}`);

      if (existing.hasHttps) {
        // 已有 HTTPS，什么都不做
        console.log('  已有 HTTPS 配置，跳过部署');
        return { configPath, action: 'skipped', reason: 'already_has_https' };
      }

      // 只有 HTTP，基于原配置改造
      console.log('  检测到 HTTP 配置，添加 HTTPS...');
      
      // 备份原配置
      if (options.backup !== false) {
        const backupPath = await this.backupConfig(configPath);
        if (backupPath) {
          console.log(`  已备份到: ${backupPath}`);
        }
      }

      // 转换配置
      const newConfig = this.transformHttpToHttps(existing.content, domain, certDir);
      await fs.writeFile(configPath, newConfig, 'utf8');
      console.log(`  已添加 HTTPS 配置: ${configPath}`);

    } else {
      // 没有现有配置，生成新配置
      console.log('  无现有配置，生成新配置...');
      const config = this.generateConfig({
        domain,
        upstream: options.upstream,
        upstreamPort: options.upstreamPort,
        webRoot: options.webRoot
      });
      await fs.writeFile(configPath, config, 'utf8');
      console.log(`  配置已写入: ${configPath}`);
    }

    // 测试并重载
    if (!(await this.testConfig())) {
      if (existing.exists && options.backup !== false) {
        console.log('  配置测试失败，恢复备份...');
        await this.restoreBackup(configPath);
      }
      throw new Error('nginx 配置测试失败');
    }

    if (options.reload !== false) {
      await this.reload();
    }

    return { configPath, action: existing.exists ? 'transformed' : 'created' };
  }

  /**
   * 远程部署（SSH 模式）
   */
  async deployRemote(domain, options, sshClient) {
    const remoteNginxConfDir = options.nginxConfDir || '/etc/nginx/conf.d';
    const remoteCertsDir = options.remoteCertsDir || '/opt/auto-cert/certs';
    const certDir = path.posix.join(remoteCertsDir, domain);
    const configPath = path.posix.join(remoteNginxConfDir, `${domain}.conf`);

    // 确保目录存在
    await sshClient.mkdir(remoteNginxConfDir);

    // 检查远程现有配置
    const exists = await sshClient.exists(configPath);

    if (exists) {
      console.log(`  检测到远程现有配置: ${configPath}`);
      const content = await sshClient.readFile(configPath);
      const hasHttps = content.includes('listen 443') || content.includes('ssl_certificate');

      if (hasHttps) {
        console.log('  已有 HTTPS 配置，跳过部署');
        return { configPath, action: 'skipped', reason: 'already_has_https' };
      }

      // 只有 HTTP，改造添加 HTTPS
      console.log('  检测到 HTTP 配置，添加 HTTPS...');
      
      // 备份
      const backupPath = `${configPath}.backup.${Date.now()}`;
      await sshClient.exec(`cp ${configPath} ${backupPath}`);
      console.log(`  已备份到: ${backupPath}`);

      // 转换并上传
      const newConfig = this.transformHttpToHttps(content, domain, certDir);
      await sshClient.writeFile(configPath, newConfig);
      console.log(`  已添加 HTTPS 配置: ${configPath}`);

    } else {
      // 生成新配置
      console.log('  无现有配置，生成新配置...');
      const config = this.generateConfig({
        domain,
        upstream: options.upstream || 'localhost',
        upstreamPort: options.upstreamPort || 3000,
        webRoot: options.webRoot || '/var/www/html',
        remoteCertsDir
      });
      await sshClient.writeFile(configPath, config);
      console.log(`  配置已上传: ${configPath}`);
    }

    // 测试并重载
    if (!(await sshClient.testNginx())) {
      throw new Error('远程 nginx 配置测试失败');
    }

    if (options.reload !== false) {
      await sshClient.reloadNginx();
    }

    return { configPath, action: exists ? 'transformed' : 'created' };
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
    } catch (err) {}
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
}

module.exports = NginxManager;
