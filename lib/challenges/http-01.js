/**
 * HTTP-01 挑战处理器
 * 适用于 Web 服务器可以直接访问的场景
 */

const fs = require('fs').promises;
const path = require('path');

class Http01Handler {
  constructor(webRoot) {
    this.webRoot = webRoot;
  }

  /**
   * 准备挑战验证文件
   */
  async prepare(challenge, keyAuthorization, domain) {
    const challengeDir = path.join(this.webRoot, '.well-known', 'acme-challenge');
    const challengePath = path.join(challengeDir, challenge.token);

    // 确保目录存在
    await fs.mkdir(challengeDir, { recursive: true });

    // 写入验证文件
    await fs.writeFile(challengePath, keyAuthorization);

    console.log(`  创建验证文件: ${challengePath}`);
    
    return challengePath;
  }

  /**
   * 清理挑战验证文件
   */
  async cleanup(challenge, domain) {
    const challengePath = path.join(
      this.webRoot,
      '.well-known',
      'acme-challenge',
      challenge.token
    );

    try {
      await fs.unlink(challengePath);
      console.log(`  清理验证文件: ${challengePath}`);
    } catch (err) {
      // 文件可能不存在，忽略错误
    }
  }
}

module.exports = Http01Handler;
