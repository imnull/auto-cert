/**
 * SSH 客户端模块
 * 支持远程服务器证书管理和 nginx 部署
 */

const { Client } = require('ssh2');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

class SshClient {
  constructor(config) {
    this.config = {
      host: config.host,
      port: config.port || 22,
      username: config.username || 'root',
      privateKey: config.privateKey,  // 可选，默认自动查找 ~/.ssh/ 下的密钥
      password: config.password,
      passphrase: config.passphrase,
      readyTimeout: config.readyTimeout || 20000
    };
    this.client = null;
    this.sftp = null;
  }

  /**
   * 查找默认私钥
   */
  async findDefaultPrivateKey() {
    const home = os.homedir();
    const sshDir = path.join(home, '.ssh');
    
    // 按优先级尝试不同的密钥文件
    const keyFiles = ['id_rsa', 'id_ed25519', 'id_ecdsa', 'id_dsa'];
    
    for (const keyFile of keyFiles) {
      const keyPath = path.join(sshDir, keyFile);
      try {
        const content = await fs.readFile(keyPath, 'utf8');
        console.log(`  找到私钥: ${keyPath}`);
        return content;
      } catch (err) {
        // 文件不存在，继续尝试下一个
      }
    }
    
    return null;
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

      // 加载私钥
      let privateKey = null;
      
      if (this.config.privateKey) {
        // 用户指定了私钥路径
        let keyPath = this.config.privateKey;
        
        // 展开 ~ 为用户主目录
        if (keyPath.startsWith('~')) {
          keyPath = keyPath.replace('~', os.homedir());
        }
        
        try {
          privateKey = await fs.readFile(keyPath, 'utf8');
          console.log(`  使用指定私钥: ${keyPath}`);
        } catch (err) {
          console.warn(`  警告: 无法读取指定私钥 ${keyPath}: ${err.message}`);
        }
      }
      
      // 如果没有指定私钥或读取失败，尝试默认私钥
      if (!privateKey) {
        privateKey = await this.findDefaultPrivateKey();
      }
      
      if (privateKey) {
        connectConfig.privateKey = privateKey;
      } else {
        console.warn('  警告: 未找到任何 SSH 私钥');
        console.warn('  请确保 ~/.ssh/ 目录下有 id_rsa、id_ed25519 等私钥文件');
        console.warn('  或在 domains.yaml 中指定 privateKey 路径');
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
   * 创建远程目录（使用 mkdir -p 命令，更可靠）
   */
  async mkdir(remotePath) {
    // 使用 SSH exec 执行 mkdir -p，比 sftp.mkdir 更可靠
    const result = await this.exec(`mkdir -p ${remotePath}`);
    if (result.code !== 0) {
      throw new Error(`创建目录失败: ${result.stderr}`);
    }
  }

  /**
   * 检查远程文件/目录是否存在
   */
  async exists(remotePath) {
    // 使用 test 命令检查，比 sftp.stat 更可靠
    const result = await this.exec(`test -e ${remotePath} && echo "EXISTS" || echo "NOT_EXISTS"`);
    return result.stdout.includes('EXISTS');
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
    
    // 上传证书文件（格式: cert.pem + cert.key）
    const certFiles = [
      { local: 'cert.pem', remote: 'cert.pem' },
      { local: 'cert.key', remote: 'cert.key' },  // 私钥本地和远程都是 cert.key
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
