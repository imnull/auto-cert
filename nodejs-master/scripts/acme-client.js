#!/usr/bin/env node
/**
 * ACME 客户端脚本
 * 支持 Let's Encrypt 证书申请与续期
 */

const acme = require('acme-client');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

// 配置文件路径
const CONFIG_DIR = process.env.AUTO_CERT_CONFIG || path.join(process.cwd(), 'config');
const CERTS_DIR = process.env.AUTO_CERT_CERTS || path.join(process.cwd(), 'certs');
const ACCOUNTS_DIR = path.join(CONFIG_DIR, 'accounts');

/**
 * 确保目录存在
 */
async function ensureDir(dir) {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
}

/**
 * 加载或创建账户密钥
 */
async function getAccountKey(email, staging = false) {
  await ensureDir(ACCOUNTS_DIR);
  const keyFile = path.join(ACCOUNTS_DIR, `${email.replace(/[@.]/g, '_')}_${staging ? 'staging' : 'prod'}.pem`);
  
  try {
    const key = await fs.readFile(keyFile, 'utf8');
    console.log(`加载已有账户密钥: ${keyFile}`);
    return key;
  } catch (err) {
    console.log('生成新的账户密钥...');
    const key = await acme.forge.createPrivateKey(4096);
    await fs.writeFile(keyFile, key, { mode: 0o600 });
    return key;
  }
}

/**
 * 获取 ACME 客户端
 */
async function getClient(email, staging = false) {
  const accountKey = await getAccountKey(email, staging);
  const directoryUrl = staging 
    ? acme.directory.letsencrypt.staging
    : acme.directory.letsencrypt.production;
  
  const client = new acme.Client({
    directoryUrl,
    accountKey
  });
  
  // 确保账户已注册
  try {
    await client.createAccount({
      termsOfServiceAgreed: true,
      contact: [`mailto:${email}`]
    });
    console.log('ACME 账户已创建/已存在');
  } catch (err) {
    console.error('账户创建失败:', err.message);
    throw err;
  }
  
  return client;
}

/**
 * HTTP-01 挑战处理器
 */
class Http01ChallengeHandler {
  constructor(webRoot = '/var/www/html') {
    this.webRoot = webRoot;
  }
  
  async prepare(challenge, keyAuthorization) {
    const challengeDir = path.join(this.webRoot, '.well-known', 'acme-challenge');
    await ensureDir(challengeDir);
    
    const challengePath = path.join(challengeDir, challenge.token);
    await fs.writeFile(challengePath, keyAuthorization);
    console.log(`创建验证文件: ${challengePath}`);
    
    return challengePath;
  }
  
  async cleanup(challenge) {
    const challengePath = path.join(this.webRoot, '.well-known', 'acme-challenge', challenge.token);
    try {
      await fs.unlink(challengePath);
      console.log(`清理验证文件: ${challengePath}`);
    } catch (err) {
      // 忽略不存在的文件
    }
  }
}

/**
 * DNS-01 挑战处理器（基类，需要子类实现具体 DNS 服务商）
 */
class Dns01ChallengeHandler {
  constructor(provider, credentials) {
    this.provider = provider;
    this.credentials = credentials;
  }
  
  getRecordName(domain) {
    return `_acme-challenge.${domain}`;
  }
  
  computeDnsValue(keyAuthorization) {
    return crypto
      .createHash('sha256')
      .update(keyAuthorization)
      .digest('base64url');
  }
  
  async addRecord(domain, recordName, recordValue) {
    throw new Error('子类必须实现 addRecord 方法');
  }
  
  async removeRecord(domain, recordName) {
    throw new Error('子类必须实现 removeRecord 方法');
  }
  
  async prepare(challenge, keyAuthorization, domain) {
    const recordName = this.getRecordName(domain);
    const recordValue = this.computeDnsValue(keyAuthorization);
    
    console.log(`添加 DNS TXT 记录: ${recordName} = ${recordValue}`);
    await this.addRecord(domain, recordName, recordValue);
    
    // 等待 DNS 传播（建议至少 30 秒）
    console.log('等待 DNS 传播 (30s)...');
    await new Promise(r => setTimeout(r, 30000));
    
    return { recordName, recordValue };
  }
  
  async cleanup(challenge, domain) {
    const recordName = this.getRecordName(domain);
    console.log(`清理 DNS TXT 记录: ${recordName}`);
    await this.removeRecord(domain, recordName);
  }
}

/**
 * 申请证书
 */
async function issueCertificate(options) {
  const {
    domain,
    email,
    challengeType = 'http-01',
    webRoot = '/var/www/html',
    staging = false,
    dnsProvider = null,
    dnsCredentials = null
  } = options;
  
  console.log(`\n=== 申请证书: ${domain} ===`);
  console.log(`环境: ${staging ? 'Staging (测试)' : 'Production (生产)'}`);
  console.log(`验证方式: ${challengeType}`);
  
  const client = await getClient(email, staging);
  
  // 创建订单
  console.log('创建订单...');
  const order = await client.createOrder({
    identifiers: [{ type: 'dns', value: domain }]
  });
  
  // 获取授权
  console.log('获取授权...');
  const authorizations = await client.getAuthorizations(order);
  
  // 创建挑战处理器
  let challengeHandler;
  if (challengeType === 'http-01') {
    challengeHandler = new Http01ChallengeHandler(webRoot);
  } else if (challengeType === 'dns-01') {
    // TODO: 根据 dnsProvider 创建具体的处理器
    throw new Error('DNS-01 需要实现具体的 DNS 服务商处理器');
  } else {
    throw new Error(`不支持的验证类型: ${challengeType}`);
  }
  
  // 处理挑战
  try {
    for (const authz of authorizations) {
      const challenge = authz.challenges.find(c => c.type === challengeType);
      if (!challenge) {
        throw new Error(`授权不支持 ${challengeType} 验证`);
      }
      
      const keyAuthorization = await client.getChallengeKeyAuthorization(challenge);
      console.log(`处理挑战: ${challenge.type}`);
      console.log(`Token: ${challenge.token}`);
      
      // 准备验证
      await challengeHandler.prepare(challenge, keyAuthorization, authz.identifier.value);
      
      // 完成挑战
      console.log('通知 ACME 服务器完成挑战...');
      await client.completeChallenge(challenge);
      
      // 等待验证完成
      console.log('等待验证...');
      await client.waitForValidStatus(challenge, { 
        retries: 10,
        interval: 5000,
        timeout: 120000
      });
      console.log('验证成功');
    }
  } finally {
    // 清理挑战资源
    for (const authz of authorizations) {
      const challenge = authz.challenges.find(c => c.type === challengeType);
      if (challenge) {
        await challengeHandler.cleanup(challenge, authz.identifier.value);
      }
    }
  }
  
  // 生成 CSR
  console.log('生成证书签名请求 (CSR)...');
  const [privateKey, csr] = await acme.forge.createCsr({
    commonName: domain,
    keySize: 2048
  });
  
  // 完成订单
  console.log('完成订单...');
  await client.finalizeOrder(order, csr);
  
  // 获取证书
  console.log('下载证书...');
  const cert = await client.getCertificate(order);
  
  // 保存证书
  await ensureDir(CERTS_DIR);
  const domainDir = path.join(CERTS_DIR, domain);
  await ensureDir(domainDir);
  
  const files = {
    privateKey: path.join(domainDir, 'privkey.pem'),
    cert: path.join(domainDir, 'cert.pem'),
    fullchain: path.join(domainDir, 'fullchain.pem')
  };
  
  await fs.writeFile(files.privateKey, privateKey, { mode: 0o600 });
  await fs.writeFile(files.cert, cert, { mode: 0o644 });
  await fs.writeFile(files.fullchain, cert, { mode: 0o644 });
  
  console.log('\n=== 证书申请成功 ===');
  console.log(`私钥: ${files.privateKey}`);
  console.log(`证书: ${files.cert}`);
  console.log(`完整链: ${files.fullchain}`);
  
  return files;
}

/**
 * 检查证书有效期
 */
async function getCertificateExpiry(certPath) {
  try {
    const certPem = await fs.readFile(certPath, 'utf8');
    // 使用 openssl 解析证书
    const { execSync } = require('child_process');
    const output = execSync(`openssl x509 -in ${certPath} -noout -dates`, { encoding: 'utf8' });
    const match = output.match(/notAfter=(.+)/);
    if (match) {
      return new Date(match[1]);
    }
  } catch (err) {
    return null;
  }
}

/**
 * 计算剩余天数
 */
function daysUntil(date) {
  const now = new Date();
  const diff = date - now;
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

/**
 * 续期证书（如果需要）
 */
async function renewCertificate(domain, options) {
  const certPath = path.join(CERTS_DIR, domain, 'cert.pem');
  const daysBeforeExpiry = options.daysBeforeExpiry || 30;
  
  console.log(`\n=== 检查证书续期: ${domain} ===`);
  
  try {
    const expiry = await getCertificateExpiry(certPath);
    if (!expiry) {
      console.log('证书不存在，申请新证书');
      return issueCertificate({ domain, ...options });
    }
    
    const days = daysUntil(expiry);
    console.log(`证书有效期至: ${expiry.toISOString()}`);
    console.log(`剩余天数: ${days} 天`);
    
    if (days <= daysBeforeExpiry) {
      console.log(`证书将在 ${days} 天后过期，开始续期...`);
      return issueCertificate({ domain, ...options });
    } else {
      console.log('证书仍然有效，无需续期');
      return null;
    }
  } catch (err) {
    console.error('检查证书失败:', err.message);
    throw err;
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
Usage: node acme-client.js <command> [options]

Commands:
  issue   申请新证书
  renew   续期证书
  check   检查证书有效期

Options:
  --domain <domain>      域名（必需）
  --email <email>        联系邮箱（必需）
  --staging              使用测试环境
  --challenge <type>     验证类型: http-01, dns-01（默认: http-01）
  --webroot <path>       HTTP 验证的根目录（默认: /var/www/html）
  --days <n>             续期触发天数（默认: 30）

Examples:
  node acme-client.js issue --domain example.com --email admin@example.com
  node acme-client.js renew --domain example.com --email admin@example.com --days 30
  node acme-client.js check --domain example.com
`);
    process.exit(0);
  }
  
  // 解析参数
  const options = {};
  for (let i = 1; i < args.length; i += 2) {
    const key = args[i].replace(/^--/, '');
    const value = args[i + 1];
    if (key === 'staging') {
      options.staging = true;
      i--; // 布尔参数没有值
    } else if (key === 'days') {
      options.daysBeforeExpiry = parseInt(value);
    } else {
      options[key] = value;
    }
  }
  
  try {
    switch (command) {
      case 'issue':
        if (!options.domain || !options.email) {
          console.error('错误: 缺少必需参数 --domain 和 --email');
          process.exit(1);
        }
        await issueCertificate(options);
        break;
        
      case 'renew':
        if (!options.domain || !options.email) {
          console.error('错误: 缺少必需参数 --domain 和 --email');
          process.exit(1);
        }
        await renewCertificate(options.domain, options);
        break;
        
      case 'check':
        if (!options.domain) {
          console.error('错误: 缺少必需参数 --domain');
          process.exit(1);
        }
        const certPath = path.join(CERTS_DIR, options.domain, 'cert.pem');
        const expiry = await getCertificateExpiry(certPath);
        if (expiry) {
          console.log(`域名: ${options.domain}`);
          console.log(`过期时间: ${expiry.toISOString()}`);
          console.log(`剩余天数: ${daysUntil(expiry)} 天`);
        } else {
          console.log(`未找到证书: ${options.domain}`);
        }
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
  issueCertificate,
  renewCertificate,
  getCertificateExpiry,
  Http01ChallengeHandler,
  Dns01ChallengeHandler
};
