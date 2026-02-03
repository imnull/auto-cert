/**
 * auto-cert 核心库
 * 整合证书管理、nginx 部署等功能
 */

const CertificateManager = require('./certificate');
const NginxManager = require('./nginx');
const Config = require('./config');
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
    return this.nginx.deploy(domain, options);
  }

  /**
   * 生成 nginx 配置（不部署）
   * @param {object} options - 选项
   * @returns {Promise<string>} nginx 配置内容
   */
  async generateNginxConfig(options) {
    return this.nginx.generateConfig(options);
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
}

module.exports = AutoCert;
