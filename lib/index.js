/**
 * auto-cert 核心库
 * 整合证书管理、nginx 部署等功能
 * 支持本地模式和 SSH 远程模式
 */

const CertificateManager = require('./certificate');
const NginxManager = require('./nginx');
const Config = require('./config');
const SshClient = require('./ssh');
const path = require('path');

class AutoCert {
  constructor(options = {}) {
    this.config = Config.load(options);
    this.certificate = new CertificateManager(this.config);
    this.nginx = new NginxManager(this.config);
  }

  /**
   * 申请新证书
   * @param {string} domain - 域名
   * @param {object} options - 选项
   * @returns {Promise<object>} 证书文件路径
   */
  async issue(domain, options = {}) {
    return this.certificate.issue(domain, options);
  }

  /**
   * 续期证书
   * @param {string} domain - 域名
   * @param {object} options - 选项
   * @returns {Promise<object|null>} 新证书文件路径，无需续期返回 null
   */
  async renew(domain, options = {}) {
    return this.certificate.renew(domain, options);
  }

  /**
   * 续期所有证书
   * @param {object} options - 选项
   * @returns {Promise<object>} 续期结果统计
   */
  async renewAll(options = {}) {
    const domains = await this.certificate.listDomains();
    const results = {
      renewed: [],
      skipped: [],
      failed: []
    };

    for (const domain of domains) {
      try {
        const renewed = await this.renew(domain, options);
        if (renewed) {
          results.renewed.push(domain);
        } else {
          results.skipped.push(domain);
        }
      } catch (err) {
        results.failed.push({ domain, error: err.message });
      }
    }

    return results;
  }

  /**
   * 部署证书到 nginx
   * @param {string} domain - 域名
   * @param {object} options - 选项
   * @returns {Promise<object>} 部署结果
   */
  async deploy(domain, options = {}) {
    // 获取域名配置，检查是否为远程模式
    const domainConfig = await this.certificate.getDomainConfig(domain);

    if (domainConfig.ssh) {
      // SSH 远程模式
      console.log(`使用 SSH 远程部署模式: ${domainConfig.ssh.host}`);

      const sshClient = new SshClient({
        host: domainConfig.ssh.host,
        port: domainConfig.ssh.port || 22,
        username: domainConfig.ssh.username,
        privateKey: domainConfig.ssh.privateKey || '~/.ssh/id_rsa',
        password: domainConfig.ssh.password
      });

      await sshClient.connect();

      try {
        const result = await this.nginx.deploy(domain, {
          upstream: options.upstream,
          upstreamPort: options.upstreamPort,
          webRoot: domainConfig.ssh.remoteWebRoot || domainConfig.webRoot,
          nginxConfDir: domainConfig.ssh.remoteNginxConfDir,
          remoteCertsDir: domainConfig.ssh.remoteCertsDir,
          backup: options.backup,
          reload: options.reload,
          sshClient
        });

        return result;
      } finally {
        await sshClient.disconnect();
      }
    }

    // 本地模式
    return this.nginx.deploy(domain, options);
  }

  /**
   * 生成 nginx 配置（不部署）
   * @param {object} options - 选项
   * @returns {Promise<string>} nginx 配置内容
   */
  async generateNginxConfig(options) {
    return this.nginx.generate(options);
  }

  /**
   * 检查证书状态
   * @param {string} domain - 域名
   * @returns {Promise<object>} 证书信息
   */
  async check(domain) {
    return this.certificate.getInfo(domain);
  }

  /**
   * 列出所有证书
   * @returns {Promise<Array>} 证书信息列表
   */
  async list() {
    const domains = await this.certificate.listDomains();
    const list = [];

    for (const domain of domains) {
      try {
        const info = await this.certificate.getInfo(domain);
        list.push(info);
      } catch (err) {
        // 忽略无法读取的证书
      }
    }

    // 按剩余天数排序
    return list.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);
  }

  /**
   * 获取域名配置
   * @param {string} domain - 域名
   * @returns {Promise<object>} 域名配置
   */
  async getDomainConfig(domain) {
    return this.certificate.getDomainConfig(domain);
  }
}

module.exports = AutoCert;
