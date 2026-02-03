/**
 * 证书管理模块
 * 处理证书申请、续期、查询等操作
 */

const acme = require('acme-client');
const fs = require('fs').promises;
const path = require('path');
const yaml = require('js-yaml');
const { execSync } = require('child_process');
const Http01Handler = require('./challenges/http-01');
const Dns01Handler = require('./challenges/dns-01');

class CertificateManager {
  constructor(config) {
    this.config = config;
    this.client = null;
  }

  /**
   * 获取或创建 ACME 客户端
   */
  async getClient() {
    if (this.client) {
      return this.client;
    }

    if (!this.config.email) {
      throw new Error('未配置邮箱，请使用 --email 或设置 AUTO_CERT_EMAIL');
    }

    // 加载或创建账户密钥
    const accountKeyPath = this.config.getAccountKeyPath(this.config.email);
    let accountKey;

    try {
      accountKey = await fs.readFile(accountKeyPath, 'utf8');
    } catch (err) {
      // 生成新密钥
      accountKey = await acme.forge.createPrivateKey(4096);
      await fs.mkdir(path.dirname(accountKeyPath), { recursive: true });
      await fs.writeFile(accountKeyPath, accountKey, { mode: 0o600 });
    }

    // 创建客户端
    const directoryUrl = this.config.staging
      ? acme.directory.letsencrypt.staging
      : acme.directory.letsencrypt.production;

    this.client = new acme.Client({
      directoryUrl,
      accountKey
    });

    // 注册账户
    try {
      await this.client.createAccount({
        termsOfServiceAgreed: true,
        contact: [`mailto:${this.config.email}`]
      });
    } catch (err) {
      // 账户已存在，忽略错误
    }

    return this.client;
  }

  /**
   * 申请新证书
   */
  async issue(domain, options = {}) {
    const client = await this.getClient();
    const challengeType = options.challengeType || this.config.challengeType;

    console.log(`创建订单: ${domain}`);
    const order = await client.createOrder({
      identifiers: [{ type: 'dns', value: domain }]
    });

    // 获取授权
    const authorizations = await client.getAuthorizations(order);

    // 创建挑战处理器
    const challengeHandler = this.createChallengeHandler(challengeType, options);

    // 处理挑战
    try {
      for (const authz of authorizations) {
        await this.processChallenge(client, authz, challengeType, challengeHandler);
      }
    } finally {
      // 清理挑战
      for (const authz of authorizations) {
        const challenge = authz.challenges.find(c => c.type === challengeType);
        if (challenge) {
          await challengeHandler.cleanup(challenge, authz.identifier.value);
        }
      }
    }

    // 生成 CSR
    console.log('生成证书签名请求...');
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
    return this.saveCertificate(domain, privateKey, cert);
  }

  /**
   * 处理单个挑战
   */
  async processChallenge(client, authz, challengeType, handler) {
    const challenge = authz.challenges.find(c => c.type === challengeType);
    if (!challenge) {
      throw new Error(`授权不支持 ${challengeType} 验证`);
    }

    const keyAuthorization = await client.getChallengeKeyAuthorization(challenge);
    console.log(`处理 ${challengeType} 挑战: ${authz.identifier.value}`);

    // 准备挑战
    await handler.prepare(challenge, keyAuthorization, authz.identifier.value);

    // 完成挑战
    await client.completeChallenge(challenge);

    // 等待验证
    console.log('等待 ACME 验证...');
    await client.waitForValidStatus(challenge, {
      retries: 15,
      interval: 3000,
      timeout: 120000
    });

    console.log('验证通过');
  }

  /**
   * 创建挑战处理器
   */
  createChallengeHandler(type, options) {
    switch (type) {
      case 'http-01':
        return new Http01Handler(options.webRoot || this.config.webRoot);

      case 'dns-01':
        return new Dns01Handler({
          provider: options.dnsProvider || this.config.dnsProvider,
          credentials: options.dnsCredentials || this.config.dnsCredentials
        });

      default:
        throw new Error(`不支持的验证类型: ${type}`);
    }
  }

  /**
   * 保存证书到文件
   */
  async saveCertificate(domain, privateKey, cert) {
    const domainDir = this.config.getDomainDir(domain);
    await fs.mkdir(domainDir, { recursive: true });

    const paths = this.config.getCertPaths(domain);

    // 保存私钥（限制权限）
    await fs.writeFile(paths.privateKey, privateKey, { mode: 0o600 });

    // 解析证书链
    const certs = cert.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) || [];

    if (certs.length === 0) {
      throw new Error('无效的证书数据');
    }

    // 第一个证书是服务器证书
    await fs.writeFile(paths.cert, certs[0], { mode: 0o644 });

    // 其余的是中间证书（链）
    if (certs.length > 1) {
      const chain = certs.slice(1).join('\n');
      await fs.writeFile(paths.chain, chain, { mode: 0o644 });
      await fs.writeFile(paths.fullchain, cert, { mode: 0o644 });
    } else {
      await fs.writeFile(paths.chain, '', { mode: 0o644 });
      await fs.writeFile(paths.fullchain, certs[0], { mode: 0o644 });
    }

    // 保存域名配置（YAML 格式）
    await this.saveDomainConfig(domain);

    return paths;
  }

  /**
   * 保存域名配置（YAML 格式）
   */
  async saveDomainConfig(domain) {
    const configPath = path.join(this.config.configDir, 'domains.yaml');

    let domains = {};
    try {
      const content = await fs.readFile(configPath, 'utf8');
      domains = yaml.load(content) || {};
    } catch (err) {
      // 文件不存在
    }

    domains[domain] = {
      issuedAt: new Date().toISOString(),
      email: this.config.email
    };

    const yamlContent = `# 域名配置
# 由 auto-cert 自动生成

${yaml.dump(domains, { indent: 2 })}`;

    await fs.writeFile(configPath, yamlContent, 'utf8');
  }

  /**
   * 续期证书
   */
  async renew(domain, options = {}) {
    const daysBeforeExpiry = options.daysBeforeExpiry || 30;
    const force = options.force || false;

    // 检查是否需要续期
    if (!force) {
      const info = await this.getInfo(domain);
      if (info.daysUntilExpiry > daysBeforeExpiry) {
        return null; // 无需续期
      }
    }

    // 获取原配置
    const domainConfig = await this.getDomainConfig(domain);

    // 重新申请证书
    return this.issue(domain, {
      ...domainConfig,
      ...options
    });
  }

  /**
   * 获取证书信息
   */
  async getInfo(domain) {
    const paths = this.config.getCertPaths(domain);

    try {
      const certPem = await fs.readFile(paths.cert, 'utf8');

      // 使用 openssl 获取证书信息
      const output = execSync(
        `openssl x509 -in ${paths.cert} -noout -dates -subject -issuer`,
        { encoding: 'utf8' }
      );

      const notAfter = output.match(/notAfter=(.+)/)?.[1];
      const notBefore = output.match(/notBefore=(.+)/)?.[1];
      const subject = output.match(/subject=.*CN\s*=\s*([^\n]+)/)?.[1];
      const issuer = output.match(/issuer=.*O\s*=\s*([^,\n]+)/)?.[1];

      const expiryDate = new Date(notAfter);
      const daysUntilExpiry = Math.floor((expiryDate - Date.now()) / (1000 * 60 * 60 * 24));

      return {
        domain,
        subject: subject?.trim(),
        issuer: issuer?.trim(),
        notBefore: new Date(notBefore),
        expiryDate,
        daysUntilExpiry,
        paths
      };
    } catch (err) {
      throw new Error(`无法读取证书: ${err.message}`);
    }
  }

  /**
   * 获取域名配置（从 YAML）
   */
  async getDomainConfig(domain) {
    const configPath = path.join(this.config.configDir, 'domains.yaml');

    try {
      const content = await fs.readFile(configPath, 'utf8');
      const domains = yaml.load(content) || {};
      return domains[domain] || {};
    } catch (err) {
      return {};
    }
  }

  /**
   * 列出所有域名
   */
  async listDomains() {
    try {
      const entries = await fs.readdir(this.config.certsDir, { withFileTypes: true });
      return entries
        .filter(e => e.isDirectory())
        .map(e => e.name);
    } catch (err) {
      return [];
    }
  }
}

module.exports = CertificateManager;
