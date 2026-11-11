// Socket layer: authenticate the handshake, run each action through the store, then
// send EVERY connected person their own fresh snapshot (so secrets never cross over).
const { EVENTS } = require('./constants');
const { createLimiter } = require('./auth');

function attach(io, { store, auth }) {
  io.use((socket, next) => {
    const who = auth.verifyToken(socket.handshake.auth && socket.handshake.auth.token);
    if (!who) return next(new Error('auth'));
    socket.data.who = who;
    next();
  });

  // One broadcast at a time; if more changes land meanwhile, run once more (so order can't flip).
  let running = false, again = false;
  async function broadcast() {
    if (running) { again = true; return; }
    running = true;
    try {
      do {
        again = false;
        const socks = [...io.sockets.sockets.values()];
        if (!socks.length) break;
        const snaps = await store.snapshots([...new Set(socks.map((s) => s.data.who))]);
        for (const s of socks) s.emit(EVENTS.STATE, snaps[s.data.who]);
      } while (again);
    } catch (e) { console.error('[broadcast]', e); }
    finally { running = false; }
  }

  const actions = {
    [EVENTS.TX_ADD]: store.addTx, [EVENTS.TX_ADJUST]: store.adjustTx,
    [EVENTS.WISH_ADD]: store.addWish, [EVENTS.WISH_UPDATE]: store.updateWish,
    [EVENTS.WISH_DELETE]: store.deleteWish, [EVENTS.WISH_BUY]: store.buyWish,
    [EVENTS.GOAL_ADD]: store.addGoal, [EVENTS.GOAL_UPDATE]: store.updateGoal,
    [EVENTS.GOAL_ALLOCATE]: store.allocate, [EVENTS.GOAL_SPEND]: store.spendGoal,
    [EVENTS.MEMORY_ADD]: store.addMemory, [EVENTS.MEMORY_DELETE]: store.deleteMemory,
    [EVENTS.MESSAGE_SET]: store.setMessage
  };

  io.on('connection', async (socket) => {
    const allow = createLimiter(40, 10000); // per socket: 40 actions / 10s
    try { socket.emit(EVENTS.STATE, await store.snapshot(socket.data.who)); } // fresh snapshot on every (re)connect
    catch (e) { console.error('[connect snapshot]', e); }

    socket.on(EVENTS.GET_STATE, async (ack) => {
      if (typeof ack !== 'function') return;
      try { ack({ ok: true, state: await store.snapshot(socket.data.who) }); } catch { ack({ ok: false, error: 'Try again' }); }
    });

    for (const [event, fn] of Object.entries(actions)) {
      socket.on(event, async (payload, ack) => {
        const reply = typeof ack === 'function' ? ack : () => {};
        if (!allow('x')) return reply({ ok: false, error: 'Slow down a little' });
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return reply({ ok: false, error: 'Bad request' });
        try {
          const result = await fn(socket.data.who, payload);
          reply({ ok: true, ...result });
          if (!result.duplicate) broadcast();
        } catch (e) {
          if (!e.isUser) console.error(`[${event}]`, e);
          reply({ ok: false, error: e.isUser ? e.message : 'Something went wrong, please try again' });
        }
      });
    }
  });
}

module.exports = { attach };
