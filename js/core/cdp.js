/*
 * Minimal Chrome DevTools Protocol client (no dependencies).
 * Works with the browser WebSocket inside the Premiere panel (CEP) and with
 * the global WebSocket in Node 22+.
 */
'use strict';

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.closed = false;

    ws.addEventListener('message', (ev) => this._onMessage(ev.data));
    ws.addEventListener('close', () => {
      this.closed = true;
      for (const p of this.pending.values()) p.reject(new Error('Browser connection closed'));
      this.pending.clear();
    });
  }

  static connect(url, WebSocketImpl) {
    const WS = WebSocketImpl || globalThis.WebSocket;
    if (!WS) throw new Error('No WebSocket implementation available');
    return new Promise((resolve, reject) => {
      const ws = new WS(url);
      ws.addEventListener('open', () => resolve(new CDP(ws)));
      ws.addEventListener('error', () => reject(new Error('Could not connect to ' + url)));
    });
  }

  _onMessage(data) {
    const msg = JSON.parse(typeof data === 'string' ? data : data.toString());
    if (msg.id !== undefined) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(p.method + ': ' + msg.error.message));
      else p.resolve(msg.result);
      return;
    }
    const handlers = this.listeners.get(msg.method);
    if (handlers) handlers.slice().forEach((h) => h(msg.params, msg.sessionId));
  }

  send(method, params, sessionId) {
    if (this.closed) return Promise.reject(new Error('Browser connection closed'));
    const id = this.nextId++;
    const msg = { id, method, params: params || {} };
    if (sessionId) msg.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify(msg));
    });
  }

  on(method, handler) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(handler);
    return () => {
      const list = this.listeners.get(method);
      const i = list.indexOf(handler);
      if (i >= 0) list.splice(i, 1);
    };
  }

  waitFor(method, sessionId, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new Error('Timed out waiting for ' + method));
      }, timeoutMs || 30000);
      const off = this.on(method, (params, sid) => {
        if (sessionId && sid !== sessionId) return;
        clearTimeout(timer);
        off();
        resolve(params);
      });
    });
  }

  close() {
    try { this.ws.close(); } catch (e) { /* ignore */ }
  }
}

module.exports = CDP;
