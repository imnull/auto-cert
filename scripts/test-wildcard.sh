#!/bin/bash
# 通配符证书申请测试脚本
# 此脚本演示如何使用 DNS-01 验证申请通配符证书

echo "======================================"
echo "auto-cert 通配符证书申请示例"
echo "======================================"
echo ""

# 配置变量（需要替换为实际值）
DOMAIN="*.clawcave.rockicat.com"
EMAIL="your-email@example.com"
CLOUDFLARE_TOKEN="your-cloudflare-api-token"

echo "📋 配置信息："
echo "  域名: $DOMAIN"
echo "  邮箱: $EMAIL"
echo "  DNS 服务商: Cloudflare"
echo ""

echo "======================================"
echo "示例 1: 申请测试证书（推荐首次使用）"
echo "======================================"
echo ""
echo "命令："
cat << EOF
npx auto-cert issue \\
  -d "$DOMAIN" \\
  -t dns-01 \\
  --dns-provider cloudflare \\
  --dns-token $CLOUDFLARE_TOKEN \\
  --email $EMAIL \\
  --staging
EOF
echo ""

echo "======================================"
echo "示例 2: 申请正式证书"
echo "======================================"
echo ""
echo "命令："
cat << EOF
npx auto-cert issue \\
  -d "$DOMAIN" \\
  -t dns-01 \\
  --dns-provider cloudflare \\
  --dns-token $CLOUDFLARE_TOKEN \\
  --email $EMAIL
EOF
echo ""

echo "======================================"
echo "示例 3: 多域名 SAN 证书"
echo "======================================"
echo ""
echo "命令："
cat << EOF
npx auto-cert issue \\
  -d "clawcave.rockicat.com,$DOMAIN" \\
  -t dns-01 \\
  --dns-provider cloudflare \\
  --dns-token $CLOUDFLARE_TOKEN \\
  --email $EMAIL
EOF
echo ""

echo "======================================"
echo "示例 4: 使用配置文件"
echo "======================================"
echo ""
echo "1. 编辑 config/config.yaml："
cat << EOF
email: $EMAIL
staging: false
challengeType: dns-01
dnsProvider: cloudflare
dnsCredentials:
  apiToken: $CLOUDFLARE_TOKEN
EOF
echo ""
echo "2. 运行简化命令："
cat << EOF
npx auto-cert issue -d "$DOMAIN"
EOF
echo ""

echo "======================================"
echo "检查证书状态"
echo "======================================"
echo ""
echo "命令："
cat << EOF
npx auto-cert check -d "$DOMAIN"
EOF
echo ""

echo "======================================"
echo "续期证书"
echo "======================================"
echo ""
echo "命令："
cat << EOF
npx auto-cert renew \\
  -d "$DOMAIN" \\
  -t dns-01 \\
  --dns-provider cloudflare \\
  --dns-token $CLOUDFLARE_TOKEN
EOF
echo ""

echo "======================================"
echo "⚠️  使用前准备"
echo "======================================"
echo ""
echo "1. 获取 Cloudflare API Token："
echo "   - 登录 Cloudflare Dashboard"
echo "   - My Profile → API Tokens → Create Token"
echo "   - 权限：Zone/DNS/Edit + Zone/Zone/Read"
echo ""
echo "2. 确保域名使用 Cloudflare DNS"
echo ""
echo "3. 替换脚本中的变量为实际值"
echo ""
echo "======================================"
echo "📖 详细文档：docs/wildcard-certificate-guide.md"
echo "======================================"
