// One tiny async database interface, two backends:
//  - Turso (hosted SQLite, free plan) via @libsql/client  -> production
//  - node:sqlite local file / memory                       -> local dev + tests
// Everything else (store.js) only uses: all / get / run / atomic / batchRead.

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('deposit','withdrawal','adjustment')),
    amount INTEGER NOT NULL,
    person TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    corrects_id TEXT REFERENCES transactions(id),
    created_at TEXT NOT NULL,
    CHECK ((type = 'adjustment' AND amount <> 0) OR (type <> 'adjustment' AND amount > 0))
  )`,
  `CREATE TRIGGER IF NOT EXISTS tx_no_update BEFORE UPDATE ON transactions
    BEGIN SELECT RAISE(ABORT, 'transactions are append-only'); END`,
  `CREATE TRIGGER IF NOT EXISTS tx_no_delete BEFORE DELETE ON transactions
    BEGIN SELECT RAISE(ABORT, 'transactions are append-only'); END`,
  `CREATE TABLE IF NOT EXISTS wishlist (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    price INTEGER NOT NULL DEFAULT 0,
    note TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'dreaming' CHECK (status IN ('dreaming','saving','bought')),
    added_by TEXT NOT NULL,
    is_secret INTEGER NOT NULL DEFAULT 0,
    owner TEXT,
    bought_price INTEGER,
    bought_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS goals (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    target INTEGER NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','reached','archived')),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  // Money set aside inside the shared balance. +set aside / -released or spent.
  `CREATE TABLE IF NOT EXISTS goal_allocations (
    id TEXT PRIMARY KEY,
    goal_id TEXT NOT NULL REFERENCES goals(id),
    amount INTEGER NOT NULL CHECK (amount <> 0),
    person TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TRIGGER IF NOT EXISTS alloc_no_update BEFORE UPDATE ON goal_allocations
    BEGIN SELECT RAISE(ABORT, 'allocations are append-only'); END`,
  `CREATE TRIGGER IF NOT EXISTS alloc_no_delete BEFORE DELETE ON goal_allocations
    BEGIN SELECT RAISE(ABORT, 'allocations are append-only'); END`,
  `CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    note TEXT NOT NULL,
    mem_date TEXT NOT NULL,
    person TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_by TEXT, updated_at TEXT)`
];

// ---------- Turso / libSQL (production) ----------
const plain = (rs) => rs.rows.map((r) => Object.fromEntries(rs.columns.map((c, i) => [c, r[i]])));
function remoteOps(exec) {
  const all = async (sql, args = []) => plain(await exec({ sql, args }));
  return { all, get: async (sql, args) => (await all(sql, args))[0], run: async (sql, args = []) => { await exec({ sql, args }); } };
}
async function openRemote(url, authToken) {
  const { createClient } = require('@libsql/client');
  const client = createClient({ url, authToken });
  await client.batch(SCHEMA.map((sql) => ({ sql, args: [] })), 'write');
  return {
    kind: 'turso',
    ...remoteOps((s) => client.execute(s)),
    batchRead: async (stmts) =>
      (await client.batch(stmts.map(([sql, args]) => ({ sql, args: args || [] })), 'read')).map(plain),
    atomic: async (fn) => {
      const tx = await client.transaction('write');
      try { const r = await fn(remoteOps((s) => tx.execute(s))); await tx.commit(); return r; }
      catch (e) { try { await tx.rollback(); } catch {} throw e; }
      finally { tx.close(); }
    }
  };
}

// ---------- node:sqlite (local dev + tests) ----------
function openLocal(file) {
  const fs = require('fs'), path = require('path');
  const { DatabaseSync } = require('node:sqlite');
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const d = new DatabaseSync(file);
  d.exec('PRAGMA foreign_keys = ON;');
  for (const s of SCHEMA) d.exec(s);
  let chain = Promise.resolve();                       // one-at-a-time, so a transaction is never interleaved
  const lock = (fn) => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };
  const ops = {
    all: async (sql, a = []) => d.prepare(sql).all(...a).map((r) => ({ ...r })),
    get: async (sql, a = []) => { const r = d.prepare(sql).get(...a); return r ? { ...r } : undefined; },
    run: async (sql, a = []) => { d.prepare(sql).run(...a); }
  };
  return {
    kind: 'local', raw: d,
    all: (...a) => lock(() => ops.all(...a)), get: (...a) => lock(() => ops.get(...a)), run: (...a) => lock(() => ops.run(...a)),
    batchRead: (stmts) => lock(async () => { const out = []; for (const [sql, a] of stmts) out.push(await ops.all(sql, a || [])); return out; }),
    atomic: (fn) => lock(async () => {
      d.exec('BEGIN IMMEDIATE');
      try { const r = await fn(ops); d.exec('COMMIT'); return r; } catch (e) { d.exec('ROLLBACK'); throw e; }
    })
  };
}

async function openFromEnv(env = process.env) {
  if (env.TURSO_DATABASE_URL) {
    if (!env.TURSO_AUTH_TOKEN) throw new Error('Bad configuration: TURSO_AUTH_TOKEN is required with TURSO_DATABASE_URL');
    return openRemote(env.TURSO_DATABASE_URL, env.TURSO_AUTH_TOKEN);
  }
  console.warn('No TURSO_DATABASE_URL set: using a LOCAL file. Fine for testing, but it is erased on free Render.');
  return openLocal(env.DB_PATH || './data/usandours.db');
}

module.exports = { openFromEnv, openLocal, SCHEMA };
