/**
 * Cloudflare DNS API 客户端
 * 用于 DNS-01 验证
 * 
 * API 文档: https://api.cloudflare.com/
 */

const https = require('https');
const url = require('url');

class CloudflareClient {
  constructor(options) {
    this.apiToken = options.apiToken;
    this.apiKey = options.apiKey;
    this.email = options.email;
    this.zoneId = options.zoneId; // 可选，会自动查找

    // 验证凭证
    if (!this.apiToken && (!this.apiKey || !this.email)) {
      throw new Error(
        'Cloudflare 凭证未配置。请提供以下之一:\n' +
        '  1. apiToken (推荐): Cloudflare API Token\n' +
        '  2. apiKey + email: Cloudflare Global API Key + 邮箱'
      );
    }
  }

  /**
   * 发送 HTTP 请求到 Cloudflare API
   */
  async request(method, path, body = null) {
    const options = {
      hostname: 'api.cloudflare.com',
      port: 443,
      path: `/client/v4${path}`,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    // 设置认证头
    if (this.apiToken) {
      options.headers['Authorization'] = `Bearer ${this.apiToken}`;
    } else {
      options.headers['X-Auth-Key'] = this.apiKey;
      options.headers['X-Auth-Email'] = this.email;
    }

    return new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const response = JSON.parse(data);
            if (response.success) {
              resolve(response);
            } else {
              const errors = response.errors?.map(e => e.message).join(', ');
              reject(new Error(`Cloudflare API 错误: ${errors}`));
            }
          } catch (err) {
            reject(new Error(`解析 Cloudflare 响应失败: ${err.message}`));
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(30000, () => {
        req.destroy();
        reject(new Error('Cloudflare API 请求超时'));
      });

      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  }

  /**
   * 查找域名的 Zone ID
   */
  async findZoneId(domain) {
    if (this.zoneId) {
      return this.zoneId;
    }

    // 提取主域名（例如：a.b.example.com -> example.com）
    const parts = domain.split('.');
    if (parts.length < 2) {
      throw new Error(`无效的域名: ${domain}`);
    }

    // 尝试查找 zone（从完整域名开始，逐步缩短）
    for (let i = 0; i < parts.length - 1; i++) {
      const testDomain = parts.slice(i).join('.');
      const response = await this.request('GET', `/zones?name=${testDomain}&status=active`);

      if (response.result && response.result.length > 0) {
        this.zoneId = response.result[0].id;
        console.log(`  找到 Cloudflare Zone: ${testDomain} (ID: ${this.zoneId})`);
        return this.zoneId;
      }
    }

    throw new Error(
      `未在 Cloudflare 中找到域名 ${domain} 的 Zone。\n` +
      `请确保:\n` +
      `  1. 域名已添加到 Cloudflare\n` +
      `  2. 域名使用 Cloudflare 的 DNS 服务`
    );
  }

  /**
   * 添加 DNS TXT 记录
   */
  async addTxtRecord(domain, name, value, ttl = 120) {
    // 查找 Zone ID
    const zoneId = await this.findZoneId(domain);

    // 提取相对于 zone 的记录名
    const zone = await this.request('GET', `/zones/${zoneId}`);
    const zoneName = zone.result.name;
    
    // 如果记录名是 zone 本身，使用 @
    let recordName = name;
    if (name === zoneName) {
      recordName = '@';
    } else if (name.endsWith(`.${zoneName}`)) {
      recordName = name.slice(0, -(`.${zoneName}`).length);
    }

    console.log(`  创建 DNS 记录: ${recordName} TXT ${value}`);

    const response = await this.request('POST', `/zones/${zoneId}/dns_records`, {
      type: 'TXT',
      name: recordName,
      content: value,
      ttl: ttl,
      proxied: false // TXT 记录不能被代理
    });

    const recordId = response.result.id;
    console.log(`  DNS 记录创建成功 (ID: ${recordId})`);

    return {
      recordId,
      recordName,
      zoneId
    };
  }

  /**
   * 删除 DNS TXT 记录
   */
  async removeTxtRecord(domain, recordId, zoneId = null) {
    if (!recordId) {
      console.warn('  警告: 没有记录 ID，无法删除');
      return;
    }

    const targetZoneId = zoneId || await this.findZoneId(domain);

    try {
      await this.request('DELETE', `/zones/${targetZoneId}/dns_records/${recordId}`);
      console.log(`  DNS 记录删除成功 (ID: ${recordId})`);
    } catch (err) {
      console.warn(`  删除 DNS 记录失败: ${err.message}`);
    }
  }

  /**
   * 查找并删除指定 TXT 记录（按名称和内容匹配）
   */
  async removeTxtRecordByName(domain, name, value) {
    const zoneId = await this.findZoneId(domain);

    // 查找匹配的记录
    const response = await this.request('GET', `/zones/${zoneId}/dns_records?type=TXT&name=${name}`);

    if (!response.result || response.result.length === 0) {
      console.log(`  未找到匹配的 DNS 记录: ${name}`);
      return;
    }

    // 找到内容匹配的记录
    const recordsToDelete = response.result.filter(record => 
      record.content === value
    );

    for (const record of recordsToDelete) {
      console.log(`  删除 DNS 记录: ${record.name} (ID: ${record.id})`);
      await this.removeTxtRecord(domain, record.id, zoneId);
    }

    if (recordsToDelete.length === 0) {
      console.log(`  未找到内容匹配的 DNS 记录: ${name}`);
    }
  }

  /**
   * 等待 DNS 记录生效
   */
  async waitForDnsPropagation(name, value, maxRetries = 10, interval = 5000) {
    console.log(`  等待 DNS 传播...`);

    for (let i = 0; i < maxRetries; i++) {
      try {
        // 使用 Google Public DNS 验证
        const response = await new Promise((resolve, reject) => {
          https.get(
            `https://dns.google/resolve?name=${name}&type=TXT`,
            (res) => {
              let data = '';
              res.on('data', chunk => data += chunk);
              res.on('end', () => {
                try {
                  resolve(JSON.parse(data));
                } catch (err) {
                  reject(err);
                }
              });
            }
          ).on('error', reject);
        });

        if (response.Answer) {
          const found = response.Answer.some(record => 
            record.data && record.data.includes(value)
          );

          if (found) {
            console.log(`  DNS 传播完成`);
            return true;
          }
        }
      } catch (err) {
        // 忽略错误，继续重试
      }

      console.log(`  等待中... (${i + 1}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, interval));
    }

    console.warn(`  DNS 传播可能未完成，继续执行`);
    return false;
  }
}

module.exports = CloudflareClient;
