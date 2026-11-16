/** 听书会话只取消自己的订阅；关闭记录拦截退出后迟到的生成请求。 */
class ListenSubscriptions {
  constructor({ now = Date.now, closedTtl = 3600000 } = {}) {
    this.now = now;
    this.closedTtl = closedTtl;
    this.closed = new Map();
  }

  valid(id) {
    return typeof id === "string" && /^[a-zA-Z0-9_-]{16,128}$/.test(id);
  }

  isClosed(id) {
    const now = this.now();
    for (const [key, expires] of this.closed) {
      if (expires <= now) this.closed.delete(key);
    }
    return this.closed.has(id);
  }

  subscribe(task, id) {
    if (!this.valid(id) || this.isClosed(id)) return false;
    if (!task.subscribers) task.subscribers = new Set();
    task.subscribers.add(id);
    return true;
  }

  release(task, id) {
    if (!task?.subscribers?.delete(id)) return false;
    return task.subscribers.size === 0;
  }

  close(id) {
    this.isClosed(id);
    this.closed.set(id, this.now() + this.closedTtl);
  }
}

module.exports = { ListenSubscriptions };
