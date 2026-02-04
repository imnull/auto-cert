#!/usr/bin/env node
/**
 * auto-cert CLI 入口
 * 自动化 HTTPS 证书申请与部署工具
 */

const { Command } = require('commander');
const chalk = require('chalk');
const pkg = require('../package.json');
const AutoCert = require('../lib');

const program = new Command();

program
  .name('auto-cert')
  .description('自动化 HTTPS 证书申请与部署工具')
  .version(pkg.version);

// 辅助函数：显示错误并退出
function handleError(err) {
  console.error(chalk.red('\n✖ 错误:'), err.message);
  if (process.env.DEBUG) {
    console.error(err.stack);
  }
  process.exit(1);
}

// 辅助函数：加载配置
async function loadConfig(options) {
  const config = require('../lib/config');
  
  // 过滤掉 undefined 值，避免覆盖配置文件
  const cleanOptions = Object.fromEntries(
    Object.entries(options).filter(([_, v]) => v !== undefined)
  );
  
  return config.load(cleanOptions);
}

// issue - 申请证书
program
  .command('issue')
  .description('申请新的 SSL 证书')
  .requiredOption('-d, --domain <domain>', '域名')
  .option('-e, --email <email>', '联系邮箱')
  .option('--staging', '使用 Let\'s Encrypt 测试环境', false)
  .option('-t, --type <type>', '验证类型 (http-01|dns-01)', 'http-01')
  .option('-w, --webroot <path>', 'HTTP 验证根目录')
  .option('--no-cleanup', '验证完成后不清理验证文件（调试用）')
  .option('--dns-provider <provider>', 'DNS 服务商 (cloudflare|aliyun|aws)')
  .action(async (options) => {
    try {
      const config = await loadConfig(options);
      const autoCert = new AutoCert(config);
      
      console.log(chalk.blue('\n▶ 开始申请证书'));
      console.log(chalk.gray(`  域名: ${options.domain}`));
      console.log(chalk.gray(`  验证方式: ${options.type}`));
      console.log(chalk.gray(`  Web 根目录: ${config.webRoot}`));
      console.log(chalk.gray(`  环境: ${options.staging ? 'Staging (测试)' : 'Production (生产)'}`));
      
      const result = await autoCert.issue(options.domain, {
        challengeType: options.type,
        webRoot: options.webroot,
        dnsProvider: options.dnsProvider,
        cleanup: options.cleanup !== false
      });
      
      console.log(chalk.green('\n✔ 证书申请成功'));
      console.log(chalk.gray(`  私钥: ${result.privateKey}`));
      console.log(chalk.gray(`  证书: ${result.cert}`));
      console.log(chalk.gray(`  完整链: ${result.fullchain}`));
      
      // 询问是否部署
      if (!options.noDeploy) {
        const { deploy } = await require('inquirer').prompt([{
          type: 'confirm',
          name: 'deploy',
          message: '是否立即部署到 nginx?',
          default: true
        }]);
        
        if (deploy) {
          await program.parseAsync(['', '', 'deploy', '-d', options.domain]);
        }
      }
    } catch (err) {
      handleError(err);
    }
  });

// renew - 续期证书
program
  .command('renew')
  .description('续期 SSL 证书')
  .requiredOption('-d, --domain <domain>', '域名')
  .option('-e, --email <email>', '联系邮箱')
  .option('--staging', '使用测试环境', false)
  .option('--days <days>', '到期前多少天触发续期', '30')
  .option('--force', '强制续期（忽略有效期检查）', false)
  .action(async (options) => {
    try {
      const config = await loadConfig(options);
      const autoCert = new AutoCert(config);
      
      console.log(chalk.blue('\n▶ 检查证书续期'));
      console.log(chalk.gray(`  域名: ${options.domain}`));
      
      const result = await autoCert.renew(options.domain, {
        daysBeforeExpiry: parseInt(options.days),
        force: options.force
      });
      
      if (result) {
        console.log(chalk.green('\n✔ 证书续期成功'));
        console.log(chalk.gray(`  新证书: ${result.cert}`));
        
        // 自动重新部署
        const { deploy } = await require('inquirer').prompt([{
          type: 'confirm',
          name: 'deploy',
          message: '是否重新部署到 nginx?',
          default: true
        }]);
        
        if (deploy) {
          await program.parseAsync(['', '', 'deploy', '-d', options.domain]);
        }
      } else {
        console.log(chalk.yellow('\n⊙ 证书仍然有效，无需续期'));
      }
    } catch (err) {
      handleError(err);
    }
  });

// renew-all - 续期所有证书
program
  .command('renew-all')
  .description('续期所有即将过期的证书')
  .option('-e, --email <email>', '联系邮箱')
  .option('--days <days>', '到期前多少天触发续期', '30')
  .option('--force', '强制续期', false)
  .action(async (options) => {
    try {
      const config = await loadConfig(options);
      const autoCert = new AutoCert(config);
      
      console.log(chalk.blue('\n▶ 检查所有证书续期'));
      
      const results = await autoCert.renewAll({
        daysBeforeExpiry: parseInt(options.days),
        force: options.force
      });
      
      if (results.renewed.length > 0) {
        console.log(chalk.green(`\n✔ 成功续期 ${results.renewed.length} 个证书`));
        for (const domain of results.renewed) {
          console.log(chalk.gray(`  - ${domain}`));
        }
      }
      
      if (results.skipped.length > 0) {
        console.log(chalk.yellow(`\n⊙ 跳过 ${results.skipped.length} 个有效证书`));
      }
      
      if (results.failed.length > 0) {
        console.log(chalk.red(`\n✖ ${results.failed.length} 个证书续期失败`));
        for (const { domain, error } of results.failed) {
          console.log(chalk.red(`  - ${domain}: ${error}`));
        }
      }
    } catch (err) {
      handleError(err);
    }
  });

// deploy - 部署证书到 nginx
program
  .command('deploy')
  .description('部署证书到 nginx')
  .requiredOption('-d, --domain <domain>', '域名')
  .option('-u, --upstream <host>', '上游服务器地址', 'localhost')
  .option('-p, --port <port>', '上游服务器端口', '3000')
  .option('-w, --webroot <path>', 'Web 根目录')
  .option('--conf-dir <path>', 'nginx 配置目录')
  .option('--no-backup', '不备份现有配置')
  .option('--no-reload', '部署后不重载 nginx')
  .action(async (options) => {
    try {
      const config = await loadConfig(options);
      const autoCert = new AutoCert(config);
      
      // 获取域名配置，检查是否为远程模式
      const domainConfig = await autoCert.getDomainConfig(options.domain);
      const isRemote = !!domainConfig.ssh;
      
      console.log(chalk.blue('\n▶ 部署证书到 nginx'));
      console.log(chalk.gray(`  域名: ${options.domain}`));
      
      if (isRemote) {
        console.log(chalk.cyan(`  模式: SSH 远程部署 (${domainConfig.ssh.host})`));
        console.log(chalk.gray(`  远程 Web 根目录: ${domainConfig.ssh.remoteWebRoot || domainConfig.webRoot || config.webRoot}`));
        console.log(chalk.gray(`  远程 nginx 配置: ${domainConfig.ssh.remoteNginxConfDir || '/etc/nginx/conf.d'}`));
      } else {
        console.log(chalk.gray(`  模式: 本地部署`));
        console.log(chalk.gray(`  Web 根目录: ${options.webroot || domainConfig.webRoot || config.webRoot}`));
        console.log(chalk.gray(`  nginx 配置目录: ${options.confDir || config.nginxConfDir}`));
      }
      
      console.log(chalk.gray(`  上游: ${options.upstream || 'localhost'}:${options.port || 3000}`));
      
      const result = await autoCert.deploy(options.domain, {
        upstream: options.upstream,
        upstreamPort: parseInt(options.port || 3000),
        webRoot: options.webroot,
        nginxConfDir: options.confDir || config.nginxConfDir,
        backup: options.backup,
        reload: options.reload
      });
      
      console.log(chalk.green('\n✔ 部署成功'));
      console.log(chalk.gray(`  配置路径: ${result.configPath}`));
    } catch (err) {
      handleError(err);
    }
  });

// check - 检查证书状态
program
  .command('check')
  .description('检查证书有效期')
  .option('-d, --domain <domain>', '指定域名（不指定则检查所有）')
  .action(async (options) => {
    try {
      const autoCert = new AutoCert({});
      
      if (options.domain) {
        // 检查单个域名
        const info = await autoCert.check(options.domain);
        
        console.log(chalk.blue('\n▶ 证书状态'));
        console.log(chalk.gray(`  域名: ${info.domain}`));
        console.log(chalk.gray(`  有效期至: ${info.expiryDate}`));
        
        const days = info.daysUntilExpiry;
        const color = days <= 7 ? 'red' : days <= 30 ? 'yellow' : 'green';
        console.log(chalk[color](`  剩余: ${days} 天`));
        
        if (info.issuer) {
          console.log(chalk.gray(`  颁发者: ${info.issuer}`));
        }
      } else {
        // 检查所有证书
        const list = await autoCert.list();
        
        console.log(chalk.blue('\n▶ 所有证书状态\n'));
        
        if (list.length === 0) {
          console.log(chalk.yellow('  暂无证书'));
          return;
        }
        
        for (const info of list) {
          const days = info.daysUntilExpiry;
          const status = days <= 7 ? chalk.red('⚠ 紧急') : 
                        days <= 30 ? chalk.yellow('⚡ 即将过期') : 
                        chalk.green('✔ 正常');
          
          console.log(`${status} ${chalk.white(info.domain)} ${chalk.gray(`(${days} 天)`)}`);
        }
      }
    } catch (err) {
      handleError(err);
    }
  });

// nginx-generate - 生成 nginx 配置
program
  .command('nginx-generate')
  .description('生成 nginx 配置（输出到 stdout）')
  .requiredOption('-d, --domain <domain>', '域名')
  .option('-u, --upstream <host>', '上游服务器地址')
  .option('-p, --port <port>', '上游服务器端口')
  .option('-w, --webroot <path>', 'Web 根目录')
  .action(async (options) => {
    try {
      const config = await loadConfig(options);
      const autoCert = new AutoCert(config);
      const nginxConfig = await autoCert.generateNginxConfig({
        domain: options.domain,
        upstream: options.upstream,
        upstreamPort: parseInt(options.port || 3000),
        webRoot: options.webroot
      });
      
      console.log(nginxConfig);
    } catch (err) {
      handleError(err);
    }
  });

// setup - 初始化配置
program
  .command('setup')
  .description('初始化 auto-cert 配置')
  .action(async () => {
    try {
      const setup = require('../scripts/setup');
      await setup.run();
    } catch (err) {
      handleError(err);
    }
  });

// 解析命令行参数
program.parse();

// 如果没有提供命令，显示帮助
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
