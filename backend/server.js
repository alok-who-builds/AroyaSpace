const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
try { process.loadEnvFile && process.loadEnvFile(); } catch { /* no .env file, fine on Render */ }

const { openFromEnv } = require('./db');
const { createStore } = require('./store');
const { loadConfig, createAuth, createLimiter } = require('./auth');
const { attach } = require('./handlers');

const cfg = loadConfig();
const origins = (process.env.FRONTEND_ORIGIN || '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
if (!origins.length) throw new Error('Bad configuration: FRONTEND_ORIGIN is required');

const auth = createAuth(cfg);

const app = express();
app.set('trust proxy', 1); // Render sits behind a proxy; needed for real client IPs
app.disable('x-powered-by');

// CORS: only our GitHub Pages site may call us.
app.use((req, res, next) => {
  const o = req.headers.origin;
  if (o && origins.includes(o)) {
    res.setHeader('Access-Control-Allow-Origin', o);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/', (req, res) => res.send('us & ours. is awake.'));   // health check + wakes Render from sleep

const loginAllowed = createLimiter(8, 10 * 60 * 1000); // 8 tries / 10 min / IP
app.post('/login', express.json({ limit: '2kb' }), (req, res) => {
  if (!loginAllowed(req.ip)) return res.status(429).json({ ok: false, error: 'Too many tries. Wait a few minutes.' });
  const { who, code } = req.body || {};
  if (!auth.checkCode(who, code)) return res.status(401).json({ ok: false, error: 'That code does not match.' });
  res.json({ ok: true, who, token: auth.issueToken(who) });
});

process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));

(async () => {
  const db = await openFromEnv();                 // Turso in production, local file when testing
  const store = createStore(db);
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: origins, methods: ['GET', 'POST'] },
    maxHttpBufferSize: 1e5
  });
  attach(io, { store, auth });
  const port = process.env.PORT || 3000;
  server.listen(port, () => console.log(`us & ours. listening on ${port} (database: ${db.kind})`));
})().catch((e) => { console.error(e); process.exit(1); });
