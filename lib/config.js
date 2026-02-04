/**
 * 配置管理模块
 * 支持 YAML 格式配置文件
 */

const fs = require('fs').promises;
const path = require('path');
const yaml = require('js-yaml');

// 默认配置
const DEFAULTS = {
  // 证书存储目录
  certsDir: path.join(process.cwd(), 'certs'),

  // 配置目录
  configDir: path.join(process.cwd(), 'config'),

  // ACME 配置
  staging: false,

  // 验证配置
  webRoot: '/var/www/html',
  challengeType: 'http-01',

  // nginx 配置
  nginxConfDir: '/etc/nginx/conf.d',
  nginxSitesDir: '/etc/nginx/sites-enabled',
  autoDeploy: false,  // 是否自动部署 nginx 配置

  // 日志
  logLevel: 'info'
};

class Config {
  constructor(options = {}) {
    // 合并配置
    this.certsDir = options.certsDir || DEFAULTS.certsDir;
    this.configDir = options.configDir || DEFAULTS.configDir;
    this.staging = options.staging ?? DEFAULTS.staging;
    this.email = options.email || null;
    this.webRoot = options.webRoot || DEFAULTS.webRoot;
    this.challengeType = options.challengeType || DEFAULTS.challengeType;
    this.nginxConfDir = options.nginxConfDir || DEFAULTS.nginxConfDir;
    this.nginxSitesDir = options.nginxSitesDir || DEFAULTS.nginxSitesDir;
    this.autoDeploy = options.autoDeploy ?? DEFAULTS.autoDeploy;
    this.logLevel = options.logLevel || DEFAULTS.logLevel;

    // DNS 配置
    this.dnsProvider = options.dnsProvider || null;
    this.dnsCredentials = options.dnsCredentials || {};

    // 派生路径
    this.accountsDir = path.join(this.configDir, 'accounts');
  }

  /**
   * 加载配置
   * 优先级：传入参数 > 配置文件 > 环境变量 > 默认值
   */
  static load(options = {}) {
    // 环境变量覆盖
    const envConfig = {
      email: process.env.AUTO_CERT_EMAIL,
      staging: process.env.AUTO_CERT_STAGING === 'true',
      certsDir: process.env.AUTO_CERT_CERTS,
      configDir: process.env.AUTO_CERT_CONFIG,
      webRoot: process.env.AUTO_CERT_WEBROOT,
      nginxConfDir: process.env.AUTO_CERT_NGINX_CONF,
      logLevel: process.env.AUTO_CERT_LOG_LEVEL
    };

    // 清理 undefined 值
    Object.keys(envConfig).forEach(key => {
      if (envConfig[key] === undefined) {
        delete envConfig[key];
      }
    });

    // 尝试加载配置文件（优先 YAML，其次 JSON）
    let fileConfig = {};
    try {
      const yamlPath = path.join(process.cwd(), 'config', 'config.yaml');
      const jsonPath = path.join(process.cwd(), 'config', 'config.json');

      if (require('fs').existsSync(yamlPath)) {
        const content = require('fs').readFileSync(yamlPath, 'utf8');
        fileConfig = yaml.load(content) || {};
      } else if (require('fs').existsSync(jsonPath)) {
        const content = require('fs').readFileSync(jsonPath, 'utf8');
        fileConfig = JSON.parse(content);
      }
    } catch (err) {
      // 配置文件不存在或无效，使用空对象
    }

    // 合并配置（优先级从低到高）
    return new Config({
      ...DEFAULTS,
      ...fileConfig,
      ...envConfig,
      ...options
    });
  }

  /**
   * 保存配置到 YAML 文件
   */
  async save() {
    const configPath = path.join(this.configDir, 'config.yaml');

    const data = {
      email: this.email,
      staging: this.staging,
      webRoot: this.webRoot,
      challengeType: this.challengeType,
      nginxConfDir: this.nginxConfDir,
      nginxSitesDir: this.nginxSitesDir,
      logLevel: this.logLevel,
      ...(this.dnsProvider && {
        dnsProvider: this.dnsProvider,
        dnsCredentials: this.dnsCredentials
      })
    };

    await fs.mkdir(this.configDir, { recursive: true });

    const yamlContent = `# auto-cert 配置文件
# 生成时间: ${new Date().toISOString()}

${yaml.dump(data, {
      indent: 2,
      lineWidth: -1,
      noRefs: true,
      sortKeys: true
    })}`;

    await fs.writeFile(configPath, yamlContent, 'utf8');

    return configPath;
  }

  /**
   * 获取域名证书目录
   */
  getDomainDir(domain) {
    return path.join(this.certsDir, domain);
  }

  /**
   * 获取域名证书文件路径
   * 格式: cert.pem + cert.key
   */
  getCertPaths(domain) {
    const domainDir = this.getDomainDir(domain);
    return {
      privateKey: path.join(domainDir, 'cert.key'),
      cert: path.join(domainDir, 'cert.pem'),
      chain: path.join(domainDir, 'chain.pem'),
      fullchain: path.join(domainDir, 'fullchain.pem')
    };
  }

  /**
   * 获取账户密钥路径
   */
  getAccountKeyPath(email) {
    const safeEmail = email.replace(/[@.]/g, '_');
    const env = this.staging ? 'staging' : 'prod';
    return path.join(this.accountsDir, `${safeEmail}_${env}.pem`);
  }

  /**
   * 确保目录存在
   */
  async ensureDirs() {
    await fs.mkdir(this.certsDir, { recursive: true });
    await fs.mkdir(this.configDir, { recursive: true });
    await fs.mkdir(this.accountsDir, { recursive: true });
  }
}

module.exports = Config;
