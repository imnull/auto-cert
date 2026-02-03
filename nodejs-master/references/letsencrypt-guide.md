# Let's Encrypt 完全指南

## 概述

Let's Encrypt 是一个免费的、自动化的、开放的证书颁发机构（CA），由 Internet Security Research Group (ISRG) 运营。

## 核心特点

| 特性 | 说明 |
|------|------|
| 免费 | 完全免费的 SSL/TLS 证书 |
| 自动化 | ACME 协议支持全自动化 |
| 安全 | 遵循最新的安全标准 |
| 透明 | 所有颁发的证书都公开记录 |
| 开放 | 开放的标准和开源软件 |

## 证书类型

### 域名验证 (DV) 证书

Let's Encrypt 只颁发域名验证证书：
- ✅ 验证域名所有权
- ❌ 不验证组织身份（无 OV/EV）

### 支持的证书

| 类型 | 支持 | 说明 |
|------|------|------|
| 单域名 | ✅ | example.com |
| 多域名 (SAN) | ✅ | 一个证书包含多个域名 |
| 通配符 | ✅ | *.example.com（需要 DNS-01） |
| IP 地址 | ❌ | 不支持纯 IP 证书 |

## 证书有效期

- **有效期**: 90 天
- **续期窗口**: 到期前 30 天开始可以续期
- **推荐续期策略**: 每 60 天自动续期

## 速率限制

### 生产环境限制

| 限制 | 值 | 重置周期 |
|------|-----|----------|
| 新注册账户 | 10 个/IP | 3 小时 |
| 新订单 | 300 个/账户 | 3 小时 |
| 颁发证书 | 50 个/注册域名 | 每周 |
| 重复证书 | 5 个/域名集合 | 每周 |
| 验证失败 | 5 次/主机名/账户/小时 | 1 小时 |
| 挂起授权 | 300 个/账户 | - |

### 测试环境 (Staging)

- 速率限制更宽松（约 10 倍）
- 颁发的证书不被浏览器信任
- 用于开发和测试

```
https://acme-staging-v02.api.letsencrypt.org/directory
```

## 环境选择

### 生产环境

```javascript
const directoryUrl = 'https://acme-v02.api.letsencrypt.org/directory';
```

- 证书被所有主流浏览器信任
- 严格的速率限制

### 测试环境

```javascript
const directoryUrl = 'https://acme-staging-v02.api.letsencrypt.org/directory';
```

- 用于测试集成
- 验证配置正确性
- 避免触发生产环境限制

## ACME 客户端实现

### 使用 acme-client 库

```bash
npm install acme-client
```

```javascript
const acme = require('acme-client');

async function main() {
  // 创建 ACME 客户端
  const client = new acme.Client({
    directoryUrl: acme.directory.letsencrypt.production,
    accountKey: await acme.forge.createPrivateKey()
  });

  // 创建账户
  await client.createAccount({
    termsOfServiceAgreed: true,
    contact: ['mailto:admin@example.com']
  });

  // 创建订单
  const order = await client.createOrder({
    identifiers: [
      { type: 'dns', value: 'example.com' },
      { type: 'dns', value: 'www.example.com' }
    ]
  });

  // 获取授权并处理挑战
  const authorizations = await client.getAuthorizations(order);
  
  for (const authz of authorizations) {
    const challenge = authz.challenges.find(c => c.type === 'http-01');
    
    // 完成挑战（设置文件或 DNS）
    console.log('Challenge token:', challenge.token);
    console.log('Key authorization:', await client.getChallengeKeyAuthorization(challenge));
    
    await client.completeChallenge(challenge);
    await client.waitForValidStatus(challenge);
  }

  // 生成 CSR
  const [key, csr] = await acme.forge.createCsr({
    commonName: 'example.com',
    altNames: ['www.example.com']
  });

  // 完成订单
  await client.finalizeOrder(order, csr);
  const cert = await client.getCertificate(order);

  console.log('Private Key:', key.toString());
  console.log('Certificate:', cert.toString());
}
```

## 通配符证书

通配符证书需要使用 DNS-01 挑战：

```javascript
const order = await client.createOrder({
  identifiers: [
    { type: 'dns', value: '*.example.com' },
    { type: 'dns', value: 'example.com' }  // 通配符不包含根域名
  ]
});
```

### DNS-01 挑战处理

```javascript
// 获取 DNS 记录信息
const challenge = authz.challenges.find(c => c.type === 'dns-01');
const keyAuthorization = await client.getChallengeKeyAuthorization(challenge);

// 计算 DNS TXT 记录值
const dnsValue = crypto
  .createHash('sha256')
  .update(keyAuthorization)
  .digest('base64url');

console.log(`添加 DNS TXT 记录:`);
console.log(`名称: _acme-challenge.${authz.identifier.value}`);
console.log(`值: ${dnsValue}`);

// 使用 DNS API 添加记录后
await client.completeChallenge(challenge);
```

## 证书续期

### 检查证书有效期

```javascript
const x509 = require('@peculiar/x509');

function getCertificateExpiry(certPem) {
  const cert = new x509.X509Certificate(certPem);
  return cert.notAfter;
}

function daysUntilExpiry(certPem) {
  const expiry = getCertificateExpiry(certPem);
  const now = new Date();
  const diff = expiry - now;
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}
```

### 自动续期逻辑

```javascript
async function renewIfNeeded(domain, certPath, daysBeforeExpiry = 30) {
  try {
    const certPem = await fs.readFile(certPath, 'utf8');
    const days = daysUntilExpiry(certPem);
    
    console.log(`${domain} 证书还有 ${days} 天过期`);
    
    if (days <= daysBeforeExpiry) {
      console.log('开始续期...');
      await issueCertificate(domain);
      console.log('续期完成');
      return true;
    }
    
    console.log('证书仍然有效，无需续期');
    return false;
  } catch (err) {
    // 证书不存在，申请新证书
    console.log('证书不存在，申请新证书...');
    await issueCertificate(domain);
    return true;
  }
}
```

## 证书吊销

### 吊销原因代码

```javascript
const REVOCATION_REASONS = {
  unspecified: 0,
  keyCompromise: 1,           // 密钥泄露
  cACompromise: 2,            // CA 泄露
  affiliationChanged: 3,      // 组织变更
  superseded: 4,              // 证书被取代
  cessationOfOperation: 5,    // 停止运营
  certificateHold: 6,         // 证书挂起
  removeFromCRL: 8,           // 从吊销列表移除
  privilegeWithdrawn: 9,      // 权限撤销
  aACompromise: 10            // 属性权威泄露
};
```

### 吊销证书

```javascript
await client.revokeCertificate(certificate, {
  reason: 'keyCompromise'
});
```

## 调试技巧

### 1. 使用 Staging 环境

在测试时使用 staging 环境避免触发速率限制。

### 2. 详细日志

```javascript
const client = new acme.Client({
  directoryUrl: acme.directory.letsencrypt.staging,
  accountKey: privateKey,
  backoffFunction: (attempt, wait) => {
    console.log(`Retry attempt ${attempt}, waiting ${wait}ms`);
    return wait;
  }
});
```

### 3. 验证挑战文件

```bash
# HTTP-01 验证
curl http://example.com/.well-known/acme-challenge/<token>

# DNS-01 验证
dig TXT _acme-challenge.example.com
```

## 常见问题

### Q: 证书可以导出为 .pfx/.p12 吗？

```javascript
const forge = require('node-forge');

function createPfx(privateKeyPem, certPem, password) {
  const pki = forge.pki;
  const key = pki.privateKeyFromPem(privateKeyPem);
  const cert = pki.certificateFromPem(certPem);
  
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(
    key, 
    [cert], 
    password,
    { algorithm: '3des' }
  );
  
  return Buffer.from(forge.asn1.toDer(p12Asn1).getBytes(), 'binary');
}
```

### Q: 如何生成兼容的私钥？

```javascript
// RSA 2048 位（最兼容）
const rsaKey = await acme.forge.createPrivateKey(2048);

// RSA 4096 位（更安全但较慢）
const rsaKey4096 = await acme.forge.createPrivateKey(4096);

// ECDSA P-256（现代、更快）
const ecKey = await acme.forge.createPrivateKeyEc('P-256');
```

### Q: 证书链不完整？

确保使用 `fullchain.pem` 而不是单独的 `cert.pem`：

```nginx
# 正确
ssl_certificate /path/to/fullchain.pem;

# 错误 - 会导致部分客户端无法验证
ssl_certificate /path/to/cert.pem;
```

## 监控与告警

### 证书有效期监控

```javascript
async function checkAllCertificates(domains) {
  const alerts = [];
  
  for (const domain of domains) {
    const certPath = `/etc/letsencrypt/live/${domain}/cert.pem`;
    try {
      const days = daysUntilExpiry(await fs.readFile(certPath, 'utf8'));
      if (days <= 7) {
        alerts.push({ domain, days, severity: 'critical' });
      } else if (days <= 30) {
        alerts.push({ domain, days, severity: 'warning' });
      }
    } catch (err) {
      alerts.push({ domain, error: err.message, severity: 'error' });
    }
  }
  
  return alerts;
}
```

## 最佳实践总结

1. **使用 staging 环境测试**
2. **妥善保存账户密钥**
3. **实现自动续期（建议 60 天周期）**
4. **监控证书有效期**
5. **配置适当的告警**
6. **保持 ACME 客户端更新**
7. **使用 DNS CAA 记录限制 CA**
8. **配置完善的 nginx SSL**
