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

    // 确保远程目录存在
    await this.sshClient.mkdir(challengeDir);

    // 创建验证文件
    await this.sshClient.writeFile(challengePath, keyAuthorization);

    console.log(`  创建远程验证文件: ${challengePath}`);

    // 设置权限
    await this.sshClient.exec(`chmod 644 ${challengePath}`);

    return challengePath;
  }

  /**
   * 清理远程服务器上的挑战验证文件
   */
  async cleanup(challenge, domain) {
    // 去除末尾斜杠避免双斜杠
    const webRoot = this.remoteWebRoot.replace(/\/$/, '');
    const challengePath = `${webRoot}/.well-known/acme-challenge/${challenge.token}`;

    try {
      await this.sshClient.exec(`rm -f ${challengePath}`);
      console.log(`  清理远程验证文件: ${challengePath}`);
    } catch (err) {
      // 文件可能不存在，忽略错误
    }
  }
}

module.exports = Http01RemoteHandler;
