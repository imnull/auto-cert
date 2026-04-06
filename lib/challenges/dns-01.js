/**
 * DNS-01 挑战处理器
 * 适用于通配符证书或无法直接访问 Web 服务器的场景
 */

const crypto = require('crypto');
const CloudflareClient = require('./dns-providers/cloudflare');

class Dns01Handler {
  constructor(options) {
    this.provider = options.provider;
    this.credentials = options.credentials;
    this.providerClient = null;
    this.createdRecords = []; // 跟踪创建的记录以便清理
  }

  /**
   * 获取 DNS 记录名
   * 注意：通配符域名的 * 需要移除，因为 DNS 记录名不能包含 *
   */
  getRecordName(domain) {
    // 移除通配符前缀
    const cleanDomain = domain.replace(/^\*\./, '');
    return `_acme-challenge.${cleanDomain}`;
  }

  /**
   * 计算 DNS TXT 记录值
   */
  computeRecordValue(keyAuthorization) {
    return crypto
      .createHash('sha256')
      .update(keyAuthorization)
      .digest('base64url');
  }

  /**
   * 获取 DNS 服务商客户端
   */
  async getProviderClient() {
    if (this.providerClient) {
      return this.providerClient;
    }

    // 根据提供商创建对应的客户端
    switch (this.provider) {
      case 'cloudflare':
        this.providerClient = new CloudflareClient({
          apiToken: this.credentials.apiToken,
          apiKey: this.credentials.apiKey,
          email: this.credentials.email,
          zoneId: this.credentials.zoneId
        });
        break;

      case 'aliyun':
        // TODO: 实现阿里云 DNS 客户端
        throw new Error('阿里云 DNS 支持尚未实现');

      case 'aws':
      case 'route53':
        // TODO: 实现 AWS Route53 客户端
        throw new Error('AWS Route53 支持尚未实现');

      default:
        throw new Error(`不支持的 DNS 服务商: ${this.provider}`);
    }

    return this.providerClient;
  }

  /**
   * 准备 DNS 记录
   */
  async prepare(challenge, keyAuthorization, domain) {
    if (!this.provider) {
      throw new Error('使用 DNS-01 验证需要指定 DNS 服务商 (--dns-provider)');
    }

    const recordName = this.getRecordName(domain);
    const recordValue = this.computeRecordValue(keyAuthorization);

    console.log(`\n  ▶ 添加 DNS TXT 记录`);
    console.log(`  记录名: ${recordName}`);
    console.log(`  记录值: ${recordValue}`);

    // 调用 DNS 服务商 API 添加记录
    const client = await this.getProviderClient();
    const result = await client.addTxtRecord(domain, recordName, recordValue);

    // 保存记录信息用于清理
    this.createdRecords.push({
      domain,
      recordName,
      recordValue,
      recordId: result.recordId,
      zoneId: result.zoneId
    });

    // 等待 DNS 传播
    console.log('\n  等待 DNS 传播...');
    await client.waitForDnsPropagation(domain, recordName, recordValue);

    return { recordName, recordValue, recordId: result.recordId };
  }

  /**
   * 清理 DNS 记录
   */
  async cleanup(challenge, domain) {
    if (!this.provider) {
      return;
    }

    console.log(`\n  ▶ 清理 DNS 记录`);

    const client = await this.getProviderClient();

    // 清理所有创建的记录
    for (const record of this.createdRecords) {
      if (record.domain === domain || domain.includes(record.domain)) {
        try {
          await client.removeTxtRecord(record.domain, record.recordId, record.zoneId);
        } catch (err) {
          console.warn(`  警告: 清理记录失败 - ${err.message}`);
        }
      }
    }

    this.createdRecords = [];
  }
}

module.exports = Dns01Handler;
