#!/usr/bin/env node
/**
 * 快速添加域名记录
 * 支持为每个域名指定独立的 webRoot 配置
 */

const fs = require('fs').promises;
const path = require('path');
const yaml = require('js-yaml');
const chalk = require('chalk');

const CONFIG_DIR = path.join(process.cwd(), 'config');
const DOMAINS_PATH = path.join(CONFIG_DIR, 'domains.yaml');

/**
 * 显示使用帮助
 */
function showHelp() {
  console.log(chalk.blue('\nUsage:'));
  console.log(chalk.white('  npm run domain:add -- <domain> [webRoot]'));
  console.log(chalk.gray(''));
  console.log(chalk.blue('Examples:'));
  console.log(chalk.white('  # 使用全局默认 webRoot'));
  console.log(chalk.gray('  npm run domain:add -- example.com'));
  console.log(chalk.white(''));
  console.log(chalk.white('  # 指定独立 webRoot'));
  console.log(chalk.gray('  npm run domain:add -- example.com /var/www/example-com'));
  console.log(chalk.white(''));
  console.log(chalk.white('  # 子域名使用不同目录'));
  console.log(chalk.gray('  npm run domain:add -- blog.example.com /var/www/blog'));
  console.log(chalk.gray(''));
  process.exit(0);
}

/**
 * 解析命令行参数
 */
function parseArgs() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    showHelp();
  }

  const domain = args[0];
  const webRoot = args[1]; // 可选

  if (domain.startsWith('-')) {
    console.log(chalk.red('\n错误: 无效参数'));
    showHelp();
  }

  return { domain, webRoot };
}

/**
 * 加载现有域名配置
 */
async function loadDomains() {
  try {
    const content = await fs.readFile(DOMAINS_PATH, 'utf8');
    return yaml.load(content) || {};
  } catch (err) {
    return {};
  }
}

/**
 * 保存域名配置
 */
async function saveDomains(domains) {
  await fs.mkdir(CONFIG_DIR, { recursive: true });

  const yamlContent = `# 域名配置
# 由 auto-cert 自动生成
#
# 说明:
#   issuedAt: 证书签发时间（由 cert:issue 自动更新，申请前为空）
#   email:    申请时使用的邮箱（由 cert:issue 自动更新）
#   webRoot:  该域名的独立 web 根目录（覆盖全局配置）
#
# 配置优先级（从高到低）:
#   1. 命令行 --webroot
#   2. 本文件中的 webRoot
#   3. config.yaml 中的 webRoot
#   4. 默认值 /var/www/html

${yaml.dump(domains, {
    indent: 2,
    lineWidth: -1,
    noRefs: true,
    sortKeys: true
  })}`;

  await fs.writeFile(DOMAINS_PATH, yamlContent, 'utf8');
}

async function run() {
  const { domain, webRoot } = parseArgs();

  console.log(chalk.blue('\n▶ 添加域名记录\n'));
  console.log(chalk.gray(`  域名: ${domain}`));
  if (webRoot) {
    console.log(chalk.gray(`  Web 根目录: ${webRoot}`));
  } else {
    console.log(chalk.gray(`  Web 根目录: 使用全局配置`));
  }

  // 加载现有配置
  const domains = await loadDomains();

  // 检查是否已存在
  if (domains[domain]) {
    console.log(chalk.yellow('\n⊙ 域名记录已存在'));
    const issuedAt = domains[domain].issuedAt;
    console.log(chalk.gray(`  签发时间: ${issuedAt || '（尚未申请证书）'}`));
    if (domains[domain].webRoot) {
      console.log(chalk.gray(`  Web 根目录: ${domains[domain].webRoot}`));
    }

    // 询问是否更新 webRoot
    if (webRoot && webRoot !== domains[domain].webRoot) {
      const { update } = await require('inquirer').prompt([{
        type: 'confirm',
        name: 'update',
        message: `是否更新 webRoot 为 ${webRoot}?`,
        default: false
      }]);

      if (update) {
        domains[domain].webRoot = webRoot;
        await saveDomains(domains);
        console.log(chalk.green('\n✔ Web 根目录已更新'));
      }
    }
    return;
  }

  // 添加新记录
  // issuedAt 在证书申请成功后由 cert:issue 自动更新
  domains[domain] = {
    issuedAt: '', // 申请成功前为空
    email: '',
    ...(webRoot && { webRoot }) // 如果有指定 webRoot 则添加
  };

  // 保存
  await saveDomains(domains);

  console.log(chalk.green('\n✔ 域名记录已添加'));
  console.log(chalk.gray(`  文件: ${DOMAINS_PATH}`));

  // 显示配置优先级提示
  console.log(chalk.blue('\n▶ 配置优先级（webRoot）:'));
  console.log(chalk.gray('  1. 命令行 --webroot'));
  if (webRoot) {
    console.log(chalk.gray(`  2. 本域名配置: ${webRoot}`));
    console.log(chalk.gray('  3. config.yaml 中的 webRoot'));
  } else {
    console.log(chalk.gray('  2. 本域名配置: （未设置）'));
    console.log(chalk.gray('  3. config.yaml 中的 webRoot'));
  }
  console.log(chalk.gray('  4. 默认值: /var/www/html'));

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
