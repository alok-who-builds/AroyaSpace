// The only file that touches fetch/socket.io. Everything else calls net.xxx().
const net = (() => {
  const KEY = 'usandours.session';
  let socket = null, session = null;
  const cb = { state: () => {}, status: () => {}, authFail: () => {} };

  const loadSession = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } };
  const saveSession = (s) => { session = s; try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} };
  const clearSession = () => { session = null; try { localStorage.removeItem(KEY); } catch {} };

  async function login(who, code) {
    let res;
    try {
      res = await fetch(CONFIG.SERVER_URL + '/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ who, code })
      });
    } catch { return { ok: false, error: 'Can\'t reach our book right now. If it was asleep, try again in a moment.' }; }
    const data = await res.json().catch(() => ({}));
    if (!data.ok) return { ok: false, error: data.error || 'Something went wrong' };
    saveSession({ who: data.who, token: data.token });
    return { ok: true };
  }

  function connect() {
    session = session || loadSession();
    if (!session) return false;
    if (socket) return true;
    cb.status('connecting');
    socket = io(CONFIG.SERVER_URL, { auth: { token: session.token }, reconnectionDelayMax: 5000 });
    socket.on('connect', () => cb.status('online'));
    socket.on('disconnect', () => cb.status('offline'));
    socket.on('connect_error', (err) => {
      if (err && err.message === 'auth') { logout(); cb.authFail(); } else cb.status('offline');
    });
    socket.on(US.EVENTS.STATE, (s) => cb.state(s));   // server sends a fresh snapshot on every (re)connect
    return true;
  }

  function send(event, payload) {
    return new Promise((resolve) => {
      if (!socket || !socket.connected) return resolve({ ok: false, error: 'We\'re offline. Try again when it says "connected".' });
      socket.timeout(8000).emit(event, payload, (err, res) => {
        resolve(err ? { ok: false, error: 'No answer from the server. Check before retrying.' } : res);
      });
    });
  }

  function logout() {
    if (socket) { socket.disconnect(); socket = null; }
    clearSession();
  }

  return {
    login, connect, send, logout,
    me: () => (session || loadSession() || {}).who || null,
    hasSession: () => !!(session || loadSession()),
    onState: (f) => (cb.state = f), onStatus: (f) => (cb.status = f), onAuthFail: (f) => (cb.authFail = f)
  };
})();
