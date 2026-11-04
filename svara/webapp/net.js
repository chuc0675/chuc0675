/* Server bilan aloqa: REST (fetch) + WebSocket (avtomatik qayta ulanish bilan). */
(function () {
  'use strict';

  class NetError extends Error {
    constructor(code, message, extra) {
      super(message || code);
      this.code = code;
      Object.assign(this, extra || {});
    }
  }

  function createClient({ base = '', onMessage, onStatus }) {
    let token = null;
    try { token = sessionStorage.getItem('svara_token'); } catch (_) {}
    let ws = null;
    let wantOpen = false;
    let attempt = 0;
    let reconnectTimer = null;
    let n = 0;
    const pending = new Map();
    let status = 'idle'; // idle | connecting | open | reconnecting | closed | unauthorized

    const setStatus = (s, info) => {
      status = s;
      onStatus && onStatus(s, info);
    };

    async function api(method, path, body, { timeout = 8000 } = {}) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeout);
      try {
        const res = await fetch(base + path, {
          method,
          headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
          body: body ? JSON.stringify(body) : undefined,
          signal: ctrl.signal,
        });
        let j = {};
        try { j = await res.json(); } catch (_) {}
        if (!res.ok) throw new NetError(j.error || 'http_' + res.status, j.message || 'Xatolik (' + res.status + ')', { status: res.status, data: j });
        return j;
      } catch (e) {
        if (e instanceof NetError) throw e;
        throw new NetError('network', 'Server bilan aloqa yo\'q');
      } finally {
        clearTimeout(t);
      }
    }

    async function login(payload) {
      const r = await api('POST', '/api/auth', payload);
      token = r.token;
      try { sessionStorage.setItem('svara_token', token); } catch (_) {}
      return r;
    }

    function wsUrl() {
      const u = base ? new URL(base) : new URL(location.href);
      return (u.protocol === 'https:' ? 'wss://' : 'ws://') + u.host + '/ws';
    }

    function connect() {
      wantOpen = true;
      clearTimeout(reconnectTimer);
      if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
      setStatus(attempt ? 'reconnecting' : 'connecting', { attempt });
      ws = new WebSocket(wsUrl());
      ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token }));
      ws.onmessage = (ev) => {
        let m;
        try { m = JSON.parse(ev.data); } catch (_) { return; }
        if (m.type === 'hello') {
          attempt = 0;
          setStatus('open');
        }
        if (m.reqId && pending.has(m.reqId)) {
          const p = pending.get(m.reqId);
          pending.delete(m.reqId);
          clearTimeout(p.t);
          if (m.type === 'error') p.reject(new NetError(m.code, m.message));
          else p.resolve(m);
        }
        onMessage && onMessage(m);
      };
      ws.onclose = (ev) => {
        for (const [, p] of pending) { clearTimeout(p.t); p.reject(new NetError('disconnected', 'Aloqa uzildi')); }
        pending.clear();
        if (ev.code === 4001) return setStatus('unauthorized');
        if (ev.code === 4003) { wantOpen = false; return setStatus('banned'); }
        if (!wantOpen) return setStatus('closed');
        attempt++;
        const delay = Math.min(10000, 400 * 2 ** Math.min(attempt, 5)) * (0.8 + Math.random() * 0.4);
        setStatus('reconnecting', { attempt, delay });
        reconnectTimer = setTimeout(connect, delay);
      };
      ws.onerror = () => {};
    }

    function close() {
      wantOpen = false;
      clearTimeout(reconnectTimer);
      if (ws) ws.close();
    }

    /** So'rov yuborish va javobni kutish (reqId orqali) */
    function request(msg, timeout = 8000) {
      return new Promise((resolve, reject) => {
        if (!ws || ws.readyState !== 1 || status !== 'open') return reject(new NetError('disconnected', 'Aloqa yo\'q'));
        const reqId = 'q' + ++n;
        const t = setTimeout(() => {
          pending.delete(reqId);
          reject(new NetError('timeout', 'Server javob bermadi'));
        }, timeout);
        pending.set(reqId, { resolve, reject, t });
        ws.send(JSON.stringify({ ...msg, reqId }));
      });
    }

    // ilova fonga o'tib qaytganda tezda qayta ulanish
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && wantOpen && (!ws || ws.readyState > 1)) {
        attempt = Math.max(attempt, 1);
        connect();
      }
    });
    window.addEventListener('online', () => wantOpen && connect());

    return {
      api,
      login,
      connect,
      close,
      request,
      get token() { return token; },
      get status() { return status; },
      clearToken() { token = null; try { sessionStorage.removeItem('svara_token'); } catch (_) {} },
    };
  }

  window.SvaraNet = { createClient, NetError };
})();
