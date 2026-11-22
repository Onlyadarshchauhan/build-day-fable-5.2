// WebSocket client with automatic reconnection and seat recovery.
export class Net extends EventTarget {
  constructor({ getHello }) {
    super();
    this.getHello = getHello;
    this.queue = [];
    this.retry = 0;
    this.status = 'connecting';
    this.connect();
  }
  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.setStatus(this.retry ? 'reconnecting' : 'connecting');
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      ws.send(JSON.stringify({ t: 'hello', ...this.getHello() }));
      this.setStatus('online');
      const q = this.queue; this.queue = [];
      q.forEach((m) => ws.send(JSON.stringify(m)));
    };
    ws.onmessage = (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      this.dispatchEvent(new CustomEvent(msg.t, { detail: msg }));
      this.dispatchEvent(new CustomEvent('any', { detail: msg }));
    };
    ws.onclose = (ev) => {
      if (ev.code === 4000) { this.setStatus('replaced'); return; } // another tab took this seat
      this.setStatus('offline');
      const delay = Math.min(8000, 500 * 2 ** this.retry++);
      setTimeout(() => this.connect(), delay);
    };
    ws.onerror = () => {};
  }
  setStatus(s) {
    this.status = s;
    this.dispatchEvent(new CustomEvent('status', { detail: s }));
  }
  send(msg) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
    else if (msg.t !== 'signal') this.queue.push(msg);
  }
}
