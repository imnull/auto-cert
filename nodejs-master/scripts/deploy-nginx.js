#!/usr/bin/env node
/**
 * nginx 配置生成与部署脚本
 */

const fs = require('fs').promises;
const path = require('path');
const { exec, execSync } = require('child_process');
const util = require('util');

const execAsync = util.promisify(exec);

// 默认路径
const DEFAULT_PATHS = {
  certsDir: process.env.AUTO_CERT_CERTS || path.join(process.cwd(), 'certs'),
  nginxConfDir: '/etc/nginx/conf.d',
  nginxSitesDir: '/etc/nginx/sites-enabled',
  webRoot: '/var/www/html'
};

/**
 * SSL 配置模板
 */
const SSL_CONFIG_TEMPLATE = `
    # SSL 证书配置
    ssl_certificate {{FULLCHAIN_PATH}};
    ssl_certificate_key {{PRIVKEY_PATH}};
    ssl_trusted_certificate {{CHAIN_PATH}};

    # SSL 协议与加密套件
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;

    # SSL Session 配置
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:50m;
    ssl_session_tickets off;

    # OCSP Stapling
    ssl_stapling on;
    ssl_stapling_verify on;
    resolver 8.8.8.8 8.8.4.4 1.1.1.1 valid=300s;
    resolver_timeout 5s;

    # 安全响应头
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
`;

/**
 * 生成 nginx 配置
 */
function generateNginxConfig(options) {
  const {
    domain,
    upstream = null,
    upstreamPort = 3000,
    webRoot = DEFAULT_PATHS.webRoot,
    certPath = path.join(DEFAULT_PATHS.certsDir, domain),
    enableHsts = true,
    enableHttp2 = true,
    locations = [],
    customConfig = ''
  } = options;

  const fullchainPath = path.join(certPath, 'fullchain.pem');
  const privkeyPath = path.join(certPath, 'privkey.pem');
  const chainPath = path.join(certPath, 'chain.pem');

  // SSL 配置
  const sslConfig = SSL_CONFIG_TEMPLATE
    .replace(/{{FULLCHAIN_PATH}}/g, fullchainPath)
    .replace(/{{PRIVKEY_PATH}}/g, privkeyPath)
    .replace(/{{CHAIN_PATH}}/g, chainPath);

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
}`;

  // 构建 location 配置
  let locationConfig = '';
  
  // 添加自定义 location
  if (locations.length > 0) {
    for (const loc of locations) {
      locationConfig += `
    location ${loc.path} {
        ${loc.directives.join('\n        ')}
    }`;
    }
  }
  
  // 默认反向代理配置
  if (upstream) {
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
    }`;
  } else {
    locationConfig += `
    location / {
        root ${webRoot}/${domain};
        index index.html index.htm;
        try_files $uri $uri/ =404;
    }`;
  }

  // HTTPS 服务器块
  const httpsBlock = `
server {
    listen 443 ssl${enableHttp2 ? ' http2' : ''};
    listen [::]:443 ssl${enableHttp2 ? ' http2' : ''};
    server_name ${domain};

${sslConfig}
${locationConfig}
${customConfig ? '\n    ' + customConfig : ''}
}`;

  return `${httpBlock}\n${httpsBlock}`;
}

/**
 * 写入 nginx 配置
 */
async function writeNginxConfig(domain, config, options = {}) {
  const { 
    nginxConfDir = DEFAULT_PATHS.nginxConfDir,
    backup = true 
  } = options;
  
  const configPath = path.join(nginxConfDir, `${domain}.conf`);
  
  // 备份现有配置
  if (backup) {
    try {
      await fs.access(configPath);
      const backupPath = `${configPath}.backup.${Date.now()}`;
      await fs.copyFile(configPath, backupPath);
      console.log(`已备份原配置: ${backupPath}`);
    } catch (err) {
      // 原配置不存在，无需备份
    }
  }
  
  await fs.writeFile(configPath, config, 'utf8');
  console.log(`nginx 配置已写入: ${configPath}`);
  
  return configPath;
}

/**
 * 测试 nginx 配置
 */
async function testNginxConfig() {
  try {
    const { stdout, stderr } = await execAsync('nginx -t');
    console.log('nginx 配置测试通过');
    return true;
  } catch (err) {
    console.error('nginx 配置测试失败:');
    console.error(err.stderr);
    return false;
  }
}

/**
 * 重载 nginx
 */
async function reloadNginx() {
  try {
    await execAsync('nginx -s reload');
    console.log('nginx 重载成功');
    return true;
  } catch (err) {
    console.error('nginx 重载失败:', err.message);
    return false;
  }
}

/**
 * 部署证书到 nginx
 */
async function deployToNginx(domain, options = {}) {
  console.log(`\n=== 部署证书到 nginx: ${domain} ===`);
  
  const config = generateNginxConfig({
    domain,
    ...options
  });
  
  // 写入配置
  const configPath = await writeNginxConfig(domain, config, options);
  
  // 测试配置
  if (!await testNginxConfig()) {
    throw new Error('nginx 配置测试失败');
  }
  
  // 重载 nginx
  if (!await reloadNginx()) {
    throw new Error('nginx 重载失败');
  }
  
  console.log('部署完成');
  return configPath;
}

/**
 * 安装证书到系统目录
 */
async function installCertificate(domain, options = {}) {
  const {
    systemCertDir = '/etc/nginx/ssl',
    reload = true
  } = options;
  
  console.log(`\n=== 安装证书: ${domain} ===`);
  
  const sourceDir = path.join(DEFAULT_PATHS.certsDir, domain);
  const targetDir = path.join(systemCertDir, domain);
  
  // 创建目标目录
  await fs.mkdir(targetDir, { recursive: true });
  
  // 复制证书文件
  const files = ['cert.pem', 'chain.pem', 'fullchain.pem', 'privkey.pem'];
  for (const file of files) {
    const source = path.join(sourceDir, file);
    const target = path.join(targetDir, file);
    try {
      await fs.copyFile(source, target);
      // 设置适当的权限
      const mode = file === 'privkey.pem' ? 0o600 : 0o644;
      await fs.chmod(target, mode);
      console.log(`已安装: ${target}`);
    } catch (err) {
      console.warn(`跳过 ${file}: ${err.message}`);
    }
  }
  
  if (reload) {
    await reloadNginx();
  }
  
  return targetDir;
}

/**
 * 删除域名配置
 */
async function removeDomain(domain, options = {}) {
  const { 
    nginxConfDir = DEFAULT_PATHS.nginxConfDir,
    reload = true 
  } = options;
  
  console.log(`\n=== 移除域名配置: ${domain} ===`);
  
  const configPath = path.join(nginxConfDir, `${domain}.conf`);
  
  try {
    await fs.unlink(configPath);
    console.log(`已删除配置: ${configPath}`);
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log('配置不存在');
    } else {
      throw err;
    }
  }
  
  if (reload) {
    await reloadNginx();
  }
}

/**
 * 列出已配置的域名
 */
async function listDomains(options = {}) {
  const { nginxConfDir = DEFAULT_PATHS.nginxConfDir } = options;
  
  console.log('\n=== 已配置的域名 ===');
  
  try {
    const files = await fs.readdir(nginxConfDir);
    const domains = files
      .filter(f => f.endsWith('.conf') && !f.includes('.backup.'))
      .map(f => f.replace('.conf', ''));
    
    if (domains.length === 0) {
      console.log('暂无配置');
    } else {
      for (const domain of domains) {
        // 检查证书有效期
        const certPath = path.join(DEFAULT_PATHS.certsDir, domain, 'cert.pem');
        let expiryInfo = '未找到证书';
        try {
          const { stdout } = await execAsync(`openssl x509 -in ${certPath} -noout -dates -subject 2>/dev/null`);
          const notAfter = stdout.match(/notAfter=(.+)/)?.[1];
          if (notAfter) {
            const days = Math.floor((new Date(notAfter) - Date.now()) / (1000 * 60 * 60 * 24));
            expiryInfo = `${days} 天后过期 (${notAfter})`;
          }
        } catch (err) {
          // 忽略
        }
        console.log(`- ${domain}: ${expiryInfo}`);
      }
    }
    
    return domains;
  } catch (err) {
    console.error('读取配置目录失败:', err.message);
    return [];
  }
}

/**
 * CLI 入口
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  if (!command) {
    console.log(`
Usage: node deploy-nginx.js <command> [options]

Commands:
  generate    生成 nginx 配置（输出到 stdout）
  deploy      部署证书并生成配置
  install     安装证书到系统目录
  remove      删除域名配置
  list        列出已配置的域名
  test        测试 nginx 配置
  reload      重载 nginx

Options:
  --domain <domain>       域名（必需）
  --upstream <host>       上游服务器地址
  --upstream-port <port>  上游服务器端口（默认: 3000）
  --webroot <path>        Web 根目录
  --conf-dir <path>       nginx 配置目录
  --no-backup             不备份现有配置
  --no-reload             部署后不重载 nginx

Examples:
  node deploy-nginx.js generate --domain example.com --upstream localhost --upstream-port 8080
  node deploy-nginx.js deploy --domain example.com --upstream localhost
  node deploy-nginx.js list
  node deploy-nginx.js remove --domain example.com
`);
    process.exit(0);
  }
  
  // 解析参数
  const options = {};
  for (let i = 1; i < args.length; i += 2) {
    const key = args[i]?.replace(/^--/, '');
    const value = args[i + 1];
    
    if (key === 'no-backup') {
      options.backup = false;
      i--;
    } else if (key === 'no-reload') {
      options.reload = false;
      i--;
    } else if (key && value) {
      const camelKey = key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      options[camelKey] = value;
    }
  }
  
  try {
    switch (command) {
      case 'generate':
        if (!options.domain) {
          console.error('错误: 缺少必需参数 --domain');
          process.exit(1);
        }
        const config = generateNginxConfig(options);
        console.log(config);
        break;
        
      case 'deploy':
        if (!options.domain) {
          console.error('错误: 缺少必需参数 --domain');
          process.exit(1);
        }
        await deployToNginx(options.domain, options);
        break;
        
      case 'install':
        if (!options.domain) {
          console.error('错误: 缺少必需参数 --domain');
          process.exit(1);
        }
        await installCertificate(options.domain, options);
        break;
        
      case 'remove':
        if (!options.domain) {
          console.error('错误: 缺少必需参数 --domain');
          process.exit(1);
        }
        await removeDomain(options.domain, options);
        break;
        
      case 'list':
        await listDomains(options);
        break;
        
      case 'test':
        await testNginxConfig();
        break;
        
      case 'reload':
        await reloadNginx();
        break;
        
      default:
        console.error(`未知命令: ${command}`);
        process.exit(1);
    }
  } catch (err) {
    console.error('错误:', err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

// 导出 API
module.exports = {
  generateNginxConfig,
  writeNginxConfig,
  deployToNginx,
  installCertificate,
  removeDomain,
  listDomains,
  testNginxConfig,
  reloadNginx
};
