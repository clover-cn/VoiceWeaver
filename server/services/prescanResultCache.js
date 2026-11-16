const crypto = require("crypto");

/** 合并相同窗口的模型请求，仅缓存成功解析的结果；失败允许重试。 */
class PrescanResultCache {
  constructor({ maxEntries = 128, ttl = 3600000, now = Date.now } = {}) {
    this.pending = new Map();
    this.completed = new Map();
    this.maxEntries = maxEntries;
    this.ttl = ttl;
    this.now = now;
  }

  async get(identity, produce) {
    const key = crypto.createHash("sha256").update(JSON.stringify(identity)).digest("hex");
    const cached = this.completed.get(key);
    if (cached && cached.expires > this.now()) return structuredClone(cached.value);
    this.completed.delete(key);
    if (!this.pending.has(key)) {
      const promise = Promise.resolve().then(produce).then((value) => {
        this.completed.set(key, { value: structuredClone(value), expires: this.now() + this.ttl });
        while (this.completed.size > this.maxEntries) {
          this.completed.delete(this.completed.keys().next().value);
        }
        return value;
      }).finally(() => this.pending.delete(key));
      this.pending.set(key, promise);
    }
    return structuredClone(await this.pending.get(key));
  }
}

module.exports = { PrescanResultCache };
