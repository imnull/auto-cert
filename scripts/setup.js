#!/usr/bin/env node
/**
 * 初始化配置脚本
 * 生成 YAML 格式配置文件
 */

const fs = require('fs').promises;
const path = require('path');
const yaml = require('js-yaml');
const inquirer = require('inquirer');
const chalk = require('chalk');
const Config = require('../lib/config');

async function run() {
  console.log(chalk.blue('\n▶ auto-cert 初始化配置\n'));

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'email',
      message: '请输入联系邮箱（用于 Let\'s Encrypt 账户）:',
      validate: (input) => {
        if (!input || !input.includes('@')) {
          return '请输入有效的邮箱地址';
        }
        return true;
      }
    },
    {
      type: 'confirm',
      name: 'staging',
      message: '是否使用 Let\'s Encrypt 测试环境（staging）?',
      default: false
    },
    {
      type: 'input',
      name: 'webRoot',
      message: 'HTTP 验证根目录:',
      default: '/var/www/html'
    },
    {
      type: 'input',
      name: 'nginxConfDir',
      message: 'nginx 配置目录:',
      default: '/etc/nginx/conf.d'
    },
    {
      type: 'list',
      name: 'challengeType',
      message: '默认验证方式:',
      choices: [
        { name: 'HTTP-01 (推荐，需要 80 端口访问)', value: 'http-01' },
        { name: 'DNS-01 (用于通配符证书)', value: 'dns-01' }
      ],
      default: 'http-01'
    }
  ]);

  // 创建配置
  const config = new Config({
    email: answers.email,
    staging: answers.staging,
    webRoot: answers.webRoot,
    nginxConfDir: answers.nginxConfDir,
    challengeType: answers.challengeType
  });

  // 确保目录存在
  await config.ensureDirs();

  // 保存配置（YAML 格式）
  const configPath = await config.save();

  console.log(chalk.green('\n✔ 配置已保存'));
  console.log(chalk.gray(`  配置文件: ${configPath}`));
  console.log(chalk.gray(`  证书目录: ${config.certsDir}`));

  // 显示配置内容预览
  const yamlContent = await fs.readFile(configPath, 'utf8');
  console.log(chalk.blue('\n▶ 配置预览:'));
  console.log(chalk.gray(yamlContent.split('\n').map(l => '  ' + l).join('\n')));

  // 显示下一步提示
  console.log(chalk.blue('\n▶ 下一步'));
  console.log(chalk.white('  1. 申请证书: npm run cert:issue -- --domain example.com'));
  console.log(chalk.white('  2. 或运行:   npx auto-cert issue -d example.com'));
}

// 如果直接运行此脚本
if (require.main === module) {
  run().catch(err => {
    console.error(chalk.red('错误:'), err.message);
    process.exit(1);
  });
}

module.exports = { run };
