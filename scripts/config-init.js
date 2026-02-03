#!/usr/bin/env node
/**
 * 初始化 config.yaml
 * 如果已存在则跳过
 */

const fs = require('fs').promises;
const path = require('path');
const yaml = require('js-yaml');
const chalk = require('chalk');

const CONFIG_PATH = path.join(process.cwd(), 'config', 'config.yaml');

// 默认配置模板
const DEFAULT_CONFIG = {
  email: '',
  staging: false,
  webRoot: '/var/www/html',
  challengeType: 'http-01',
  nginxConfDir: '/etc/nginx/conf.d',
  nginxSitesDir: '/etc/nginx/sites-enabled',
  logLevel: 'info'
};

async function run() {
  console.log(chalk.blue('\n▶ 检查配置文件\n'));

  // 检查文件是否已存在
  try {
    await fs.access(CONFIG_PATH);
    console.log(chalk.yellow('⊙ 配置文件已存在，跳过创建'));
    console.log(chalk.gray(`  路径: ${CONFIG_PATH}`));
    return;
  } catch (err) {
    // 文件不存在，继续创建
  }

  // 确保 config 目录存在
  await fs.mkdir(path.dirname(CONFIG_PATH), { recursive: true });

  // 生成 YAML 内容
  const yamlContent = `# auto-cert 配置文件
# 生成时间: ${new Date().toISOString()}
#
# 配置说明:
#   email:          Let's Encrypt 联系邮箱
#   staging:        是否使用测试环境 (true/false)
#   webRoot:        HTTP-01 验证根目录
#   challengeType:  验证方式 (http-01 或 dns-01)
#   nginxConfDir:   nginx 配置目录
#   nginxSitesDir:  nginx 站点配置目录
#   logLevel:       日志级别 (debug/info/warn/error)

${yaml.dump(DEFAULT_CONFIG, {
    indent: 2,
    lineWidth: -1,
    noRefs: true,
    sortKeys: true
  })}`;

  // 写入文件
  await fs.writeFile(CONFIG_PATH, yamlContent, 'utf8');

  console.log(chalk.green('✔ 配置文件已创建'));
  console.log(chalk.gray(`  路径: ${CONFIG_PATH}`));
  console.log(chalk.blue('\n▶ 请编辑配置文件，设置您的邮箱:'));
  console.log(chalk.white(`  email: "your-email@example.com"`));
}

// 如果直接运行此脚本
if (require.main === module) {
  run().catch(err => {
    console.error(chalk.red('错误:'), err.message);
    process.exit(1);
  });
}

module.exports = { run };
