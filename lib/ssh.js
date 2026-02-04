/**
 * SSH 客户端模块
 * 支持远程服务器证书管理和 nginx 部署
 */

const { Client } = require('ssh2');
const fs = require('fs').promises;
const path = require('path');

class SshClient {
  constructor(config) {
    this.config = {
      host: config.host,
      port: config.port || 22,
      username: config.username || 'root',
      privateKey: config.privateKey,  // 可选，默认使用 SSH agent 或 ~/.ssh/id_rsa
      password: config.password,
      passphrase: config.passphrase,
      readyTimeout: config.readyTimeout || 20000
    };
    this.client = null;
    this.sftp = null;
  }

  /**
   * 建立 SSH 连接
   */
  async connect() {
    return new Promise(async (resolve, reject) => {
      this.client = new Client();
      
      this.client.on('ready', () => {
        console.log(`SSH 已连接: ${this.config.host}`);
        resolve();
      });

      this.client.on('error', (err) => {
        reject(new Error(`SSH 连接失败: ${err.message}`));
      });

      // 准备连接配置
      const connectConfig = {
        host: this.config.host,
        port: this.config.port,
        username: this.config.username,
        password: this.config.password,
        passphrase: this.config.passphrase,
        readyTimeout: this.config.readyTimeout
      };

      // 加载私钥（如果配置了）
      let useAgent = false;
      if (this.config.privateKey) {
        let privateKey = this.config.privateKey;
        // 如果不是以 BEGIN 开头，认为是文件路径
        if (!privateKey.includes('BEGIN')) {
          // 展开 ~ 为用户主目录
          if (privateKey.startsWith('~')) {
            privateKey = privateKey.replace('~', require('os').homedir());
          }
          try {
            privateKey = await fs.readFile(privateKey, 'utf8');
          } catch (err) {
            console.warn(`警告: 无法读取私钥 ${this.config.privateKey}: ${err.message}`);
            console.warn('尝试使用 SSH agent...');
            useAgent = true;
          }
        }
        if (privateKey.includes('BEGIN')) {
          connectConfig.privateKey = privateKey;
        }
      } else {
        // 没有配置私钥，尝试使用 SSH agent
        useAgent = true;
      }

      // 使用 SSH agent
      if (useAgent) {
        const agent = process.env.SSH_AUTH_SOCK;
        if (agent) {
          connectConfig.agent = agent;
          console.log('使用 SSH agent 认证...');
        } else {
          console.warn('警告: 未找到 SSH agent，尝试使用默认私钥...');
          // 尝试默认私钥
          const defaultKeyPath = require('path').join(require('os').homedir(), '.ssh', 'id_rsa');
          try {
            connectConfig.privateKey = await fs.readFile(defaultKeyPath, 'utf8');
          } catch (err) {
            console.warn(`无法读取默认私钥: ${err.message}`);
          }
        }
      }

      this.client.connect(connectConfig);
    });
  }

  /**
   * 断开连接
   */
  disconnect() {
    return new Promise((resolve) => {
      if (this.client) {
        this.client.end();
        console.log(`SSH 已断开: ${this.config.host}`);
      }
      resolve();
    });
  }

  /**
   * 执行远程命令
   */
  async exec(command) {
    return new Promise((resolve, reject) => {
      this.client.exec(command, (err, stream) => {
        if (err) return reject(err);

        let stdout = '';
        let stderr = '';

        stream.on('close', (code, signal) => {
          resolve({
            code,
            signal,
            stdout: stdout.trim(),
            stderr: stderr.trim()
          });
        });

        stream.on('data', (data) => {
          stdout += data;
        });

        stream.stderr.on('data', (data) => {
          stderr += data;
        });
      });
    });
  }

  /**
   * 获取 SFTP 会话
   */
  async getSftp() {
    if (this.sftp) return this.sftp;
    
    return new Promise((resolve, reject) => {
      this.client.sftp((err, sftp) => {
        if (err) return reject(err);
        this.sftp = sftp;
        resolve(sftp);
      });
    });
  }

  /**
   * 上传文件
   */
  async uploadFile(localPath, remotePath) {
    const sftp = await this.getSftp();
    
    return new Promise((resolve, reject) => {
      sftp.fastPut(localPath, remotePath, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  /**
   * 下载文件
   */
  async downloadFile(remotePath, localPath) {
    const sftp = await this.getSftp();
    
    return new Promise((resolve, reject) => {
      sftp.fastGet(remotePath, localPath, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  /**
   * 创建远程目录
   */
  async mkdir(remotePath) {
    const sftp = await this.getSftp();
    
    return new Promise((resolve, reject) => {
      sftp.mkdir(remotePath, { recursive: true }, (err) => {
        if (err && err.code !== 4) { // 4 = 目录已存在
          return reject(err);
        }
        resolve();
      });
    });
  }

  /**
   * 检查远程文件是否存在
   */
  async exists(remotePath) {
    const sftp = await this.getSftp();
    
    return new Promise((resolve) => {
      sftp.stat(remotePath, (err) => {
        resolve(!err);
      });
    });
  }

  /**
   * 上传目录（递归）
   */
  async uploadDir(localDir, remoteDir) {
    const sftp = await this.getSftp();
    
    // 先创建远程目录
    await this.mkdir(remoteDir);
    
    // 读取本地目录
    const entries = await fs.readdir(localDir, { withFileTypes: true });
    
    for (const entry of entries) {
      const localPath = path.join(localDir, entry.name);
      const remotePath = path.posix.join(remoteDir, entry.name);
      
      if (entry.isDirectory()) {
        await this.uploadDir(localPath, remotePath);
      } else {
        await this.uploadFile(localPath, remotePath);
      }
    }
  }

  /**
   * 写入远程文件内容
   */
  async writeFile(remotePath, content) {
    const sftp = await this.getSftp();
    
    return new Promise((resolve, reject) => {
      const stream = sftp.createWriteStream(remotePath);
      
      stream.on('error', reject);
      stream.on('close', resolve);
      
      stream.write(content);
      stream.end();
    });
  }

  /**
   * 读取远程文件内容
   */
  async readFile(remotePath) {
    const sftp = await this.getSftp();
    
    return new Promise((resolve, reject) => {
      let content = '';
      const stream = sftp.createReadStream(remotePath);
      
      stream.on('data', (data) => {
        content += data;
      });
      
      stream.on('error', reject);
      stream.on('close', () => {
        resolve(content);
      });
    });
  }

  /**
   * 测试 nginx 配置（远程）
   */
  async testNginx() {
    const result = await this.exec('nginx -t');
    return result.code === 0;
  }

  /**
   * 重载 nginx（远程）
   */
  async reloadNginx() {
    const result = await this.exec('nginx -s reload');
    if (result.code !== 0) {
      throw new Error(`远程 nginx 重载失败: ${result.stderr}`);
    }
    return true;
  }

  /**
   * 安装证书到远程服务器
   * 格式: cert.pem + cert.key
   */
  async installCertificate(domain, localCertDir, remoteCertDir) {
    console.log(`  上传证书到远程服务器...`);
    
    // 创建远程证书目录
    const remoteDomainDir = path.posix.join(remoteCertDir, domain);
    await this.mkdir(remoteDomainDir);
    
    // 上传证书文件（简化格式: cert.pem + cert.key）
    const certFiles = [
      { local: 'cert.pem', remote: 'cert.pem' },
      { local: 'privkey.pem', remote: 'cert.key' },
      { local: 'fullchain.pem', remote: 'fullchain.pem' },
      { local: 'chain.pem', remote: 'chain.pem' }
    ];
    
    for (const { local, remote } of certFiles) {
      const localPath = path.join(localCertDir, local);
      const remotePath = path.posix.join(remoteDomainDir, remote);
      
      try {
        await this.uploadFile(localPath, remotePath);
        // 设置权限
        const mode = remote === 'cert.key' ? '600' : '644';
        await this.exec(`chmod ${mode} ${remotePath}`);
        console.log(`    ✓ ${remote}`);
      } catch (err) {
        console.log(`    ✗ ${remote} (跳过: ${err.message})`);
      }
    }
    
    return remoteDomainDir;
  }
}

module.exports = SshClient;
