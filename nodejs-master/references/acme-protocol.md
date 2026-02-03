# ACME 协议详解

## 概述

ACME (Automatic Certificate Management Environment) 是由 Let's Encrypt 开发的协议，用于自动化域名验证和证书颁发。RFC 8555 定义了 ACME v2 协议标准。

## 核心概念

### 1. 账户 (Account)

- 使用公钥/私钥对标识
- 需要一个有效的邮箱地址
- 可以管理多个证书订单

### 2. 订单 (Order)

- 代表一个证书请求
- 包含状态：pending → ready → processing → valid/invalid
- 一个订单可以包含多个域名（SAN）

### 3. 授权 (Authorization)

- 代表对特定域名的验证授权
- 包含多个挑战（challenges）
- 验证成功后颁发证书

### 4. 挑战 (Challenge)

验证域名所有权的方式：

#### HTTP-01 Challenge

```
请求地址: http://<domain>/.well-known/acme-challenge/<token>
响应内容: <token>.<key-auth>
```

**适用场景**: 
- 单一域名验证
- 服务器可以直接响应 80 端口

**限制**:
- 不能用于通配符证书
- 必须能通过公网访问 80 端口

#### DNS-01 Challenge

```
记录名: _acme-challenge.<domain>
记录类型: TXT
记录值: <key-auth-digest>
```

**适用场景**:
- 通配符证书 (*.example.com)
- 内部域名验证
- 多域名负载均衡场景

**限制**:
- 需要 DNS 服务商 API 权限
- DNS 传播可能需要时间

#### TLS-ALPN-01 Challenge

```
使用 TLS 应用层协议协商完成验证
在 TLS 握手过程中完成挑战
```

**适用场景**:
- 443 端口可用但 80 端口被阻止
- 需要特殊 TLS 配置

## 协议流程

### 完整证书申请流程

```
┌─────────┐                                    ┌─────────────┐
│ Client  │                                    │ ACME Server │
└────┬────┘                                    └──────┬──────┘
     │                                                │
     │ 1. Create Account (POST /newAccount)          │
     │ ─────────────────────────────────────────────>│
     │                                                │
     │ 2. Create Order (POST /newOrder)              │
     │ ─────────────────────────────────────────────>│
     │                                                │
     │ 3. Get Authorizations                         │
     │ <─────────────────────────────────────────────│
     │                                                │
     │ 4. Select Challenge & Respond                 │
     │ ─────────────────────────────────────────────>│
     │                                                │
     │ 5. Poll Authorization Status                  │
     │ ─────────────────────────────────────────────>│
     │ <─────────────────────────────────────────────│
     │                                                │
     │ 6. Finalize Order (POST CSR)                  │
     │ ─────────────────────────────────────────────>│
     │                                                │
     │ 7. Poll Order Status & Download Certificate   │
     │ ─────────────────────────────────────────────>│
     │ <─────────────────────────────────────────────│
```

## 关键 API 端点

### Let's Encrypt 目录 URL

```javascript
const DIRECTORY_URLS = {
  // 生产环境
  production: 'https://acme-v02.api.letsencrypt.org/directory',
  // 测试环境（速率限制宽松）
  staging: 'https://acme-staging-v02.api.letsencrypt.org/directory'
};
```

### 核心端点

| 端点 | 方法 | 描述 |
|------|------|------|
| `/directory` | GET | 获取所有可用端点 |
| `/newNonce` | HEAD | 获取新 nonce（防重放） |
| `/newAccount` | POST | 创建/查找账户 |
| `/newOrder` | POST | 创建证书订单 |
| `/authz/{id}` | POST | 获取授权详情 |
| `/chall/{id}` | POST | 响应挑战 |
| `/finalize/{id}` | POST | 提交 CSR |
| `/cert/{id}` | POST | 下载证书 |
| `/revokeCert` | POST | 吊销证书 |

## JWS 签名

ACME 使用 JSON Web Signature (JWS) 对所有请求进行签名：

```javascript
const jws = {
  protected: base64url(header),
  payload: base64url(payload),
  signature: base64url(signature)
};
```

### 关键 Header 字段

```javascript
const header = {
  alg: 'ES256',           // 算法
  nonce: 'xxx',           // 防重放 nonce
  url: 'https://...',     // 请求 URL
  kid: 'https://...'      // 账户 URL（已有账户）
  // 或
  jwk: { ... }            // 公钥（新账户）
};
```

## 错误处理

### 常见错误类型

```javascript
const ERROR_TYPES = {
  // 账户错误
  'urn:ietf:params:acme:error:accountDoesNotExist': '账户不存在',
  'urn:ietf:params:acme:error:alreadyRevoked': '证书已吊销',
  
  // 验证错误
  'urn:ietf:params:acme:error:dns': 'DNS 查询失败',
  'urn:ietf:params:acme:error:connection': '无法连接服务器',
  'urn:ietf:params:acme:error:unauthorized': '验证失败',
  
  // 客户端错误
  'urn:ietf:params:acme:error:badCSR': 'CSR 格式错误',
  'urn:ietf:params:acme:error:badNonce': 'nonce 错误',
  'urn:ietf:params:acme:error:rateLimited': '速率限制',
  
  // 服务器错误
  'urn:ietf:params:acme:error:serverInternal': '服务器内部错误',
  'urn:ietf:params:acme:error:timeout': '验证超时'
};
```

## 速率限制

### Let's Encrypt 限制

| 限制类型 | 值 | 说明 |
|---------|-----|------|
| 新订单 | 300/3小时 | 每个账户 |
| 新账户 | 10/3小时 | 每个 IP |
| 证书颁发 | 50/周 | 每个注册域名 |
| 重复证书 | 5/周 | 相同域名集合 |
| 验证失败 | 5/小时 | 每个账户、主机名、小时 |
| 挂起授权 | 300 | 每个账户 |

### 速率限制响应

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 3600
```

## 证书链

### 证书文件

```
fullchain.pem = 服务器证书 + 中间证书
chain.pem = 中间证书
cert.pem = 服务器证书
privkey.pem = 私钥
```

### Let's Encrypt 证书链（R3 中间证书）

```
ISRG Root X1 (自签名根证书)
    ↓ 签名
R3 中间证书
    ↓ 签名
服务器证书
```

## 最佳实践

1. **使用 staging 环境测试**
   - 避免触发生产环境速率限制
   - 测试完成后再切换到生产环境

2. **正确存储账户密钥**
   - 使用安全的方式存储私钥
   - 密钥丢失无法恢复账户

3. **处理验证失败**
   - 实现指数退避重试
   - 记录失败原因便于排查

4. **自动续期策略**
   - 建议在到期前 30 天开始续期
   - 失败时每天重试一次

5. **监控和告警**
   - 监控证书有效期
   - 续期失败时发送告警
