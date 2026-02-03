#!/usr/bin/env node
/**
 * 快速添加域名记录
 * 仅输入域名，自动创建/追加到 domains.yaml
 */

const fs = require('fs').promises;
const path = require('path');
const yaml = require('js-yaml');
const chalk = require('chalk');

const CONFIG_DIR = path.join(process.cwd(), 'config');
const DOMAINS_PATH = path.join(CONFIG_DIR, 'domains.yaml');

/**
 * 解析命令行参数
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const domain = args[0];

  if (!domain || domain.startsWith('-')) {
    console.log(chalk.yellow('\nUsage: npm run domain:add -- <domain>'));
    console.log(chalk.gray('Example: npm run domain:add -- example.com\n'));
    process.exit(1);
  }

  return { domain };
}

/**
 * 加载现有域名配置
 */
async function loadDomains() {
  try {
    const content = await fs.readFile(DOMAINS_PATH, 'utf8');
    return yaml.load(content) || {};
  } catch (err) {
    // 文件不存在或解析失败，返回空对象
    return {};
  }
}

/**
 * 保存域名配置
 */
async function saveDomains(domains) {
  // 确保目录存在
  await fs.mkdir(CONFIG_DIR, { recursive: true });

  const yamlContent = `# 域名配置
# 由 auto-cert 自动生成
# 
# 说明:
#   issuedAt: 证书签发时间（首次申请成功的时间）
#   email:    申请证书时使用的邮箱
#
# 注意: 这是记录文件，不是证书本身。
#       证书文件存储在 certs/<domain>/ 目录下

${yaml.dump(domains, {
    indent: 2,
    lineWidth: -1,
    noRefs: true,
    sortKeys: true
  })}`;

  await fs.writeFile(DOMAINS_PATH, yamlContent, 'utf8');
}

async function run() {
  const { domain } = parseArgs();

  console.log(chalk.blue('\n▶ 添加域名记录\n'));
  console.log(chalk.gray(`  域名: ${domain}`));

  // 加载现有配置
  const domains = await loadDomains();

  // 检查是否已存在
  if (domains[domain]) {
    console.log(chalk.yellow('⊙ 域名记录已存在'));
    console.log(chalk.gray(`  签发时间: ${domains[domain].issuedAt}`));
    return;
  }

  // 添加新记录
  // issuedAt 是"签发时间"，表示证书首次申请成功的时间
  // 不是过期时间！Let's Encrypt 证书有效期为 90 天
  domains[domain] = {
    issuedAt: null,  // 首次申请时会更新为实际时间
    email: ''        // 申请时会填入实际邮箱
  };

  // 保存
  await saveDomains(domains);

  console.log(chalk.green('✔ 域名记录已添加'));
  console.log(chalk.gray(`  文件: ${DOMAINS_PATH}`));
  console.log(chalk.blue('\n▶ 下一步:'));
  console.log(chalk.white(`  npm run cert:issue -- --domain ${domain}`));
}

// 如果直接运行此脚本
if (require.main === module) {
  run().catch(err => {
    console.error(chalk.red('错误:'), err.message);
    process.exit(1);
  });
}

module.exports = { run };
