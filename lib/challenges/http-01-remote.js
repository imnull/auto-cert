/**
 * HTTP-01 远程挑战处理器（SSH 模式）
 * 通过 SSH 在远程服务器上创建验证文件
 */

class Http01RemoteHandler {
  constructor(sshClient, remoteWebRoot) {
    this.sshClient = sshClient;
    this.remoteWebRoot = remoteWebRoot;
  }

  /**
   * 在远程服务器上准备挑战验证文件
   */
  async prepare(challenge, keyAuthorization, domain) {
    // 去除末尾斜杠避免双斜杠
    const webRoot = this.remoteWebRoot.replace(/\/$/, '');
    const challengeDir = `${webRoot}/.well-known/acme-challenge`;
    const challengePath = `${challengeDir}/${challenge.token}`;

    try {
      // 确保远程目录存在（mkdir -p）
      console.log(`  创建远程目录: ${challengeDir}`);
      await this.sshClient.mkdir(challengeDir);
      
      // 验证目录是否创建成功
      const dirExists = await this.sshClient.exists(challengeDir);
      if (!dirExists) {
        throw new Error(`目录创建失败或无法访问: ${challengeDir}`);
      }
      
      // 创建验证文件
      console.log(`  创建远程验证文件: ${challengePath}`);
      await this.sshClient.writeFile(challengePath, keyAuthorization);
      
      // 验证文件是否写入成功
      const fileExists = await this.sshClient.exists(challengePath);
      if (!fileExists) {
        throw new Error(`文件写入失败: ${challengePath}`);
      }
      
      // 设置权限
      await this.sshClient.exec(`chmod 644 ${challengePath}`);
      
      console.log(`  ✓ 远程验证文件创建成功`);
      return challengePath;
    } catch (err) {
      console.error(`  ✗ 创建验证文件失败: ${err.message}`);
      throw new Error(`HTTP-01 远程验证文件创建失败: ${err.message}`);
    }
  }

  /**
   * 清理远程服务器上的挑战验证文件
   */
  async cleanup(challenge, domain) {
    // 去除末尾斜杠避免双斜杠
    const webRoot = this.remoteWebRoot.replace(/\/$/, '');
    const challengePath = `${webRoot}/.well-known/acme-challenge/${challenge.token}`;

    try {
      // 检查文件是否存在
      const exists = await this.sshClient.exists(challengePath);
      if (exists) {
        await this.sshClient.exec(`rm -f ${challengePath}`);
        console.log(`  清理远程验证文件: ${challengePath}`);
      }
    } catch (err) {
      // 清理失败不阻断流程，只打印警告
      console.warn(`  警告: 清理验证文件失败: ${err.message}`);
    }
  }
}

module.exports = Http01RemoteHandler;
