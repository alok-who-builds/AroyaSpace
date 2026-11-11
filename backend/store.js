// All the rules live here: balance, secrets, goals. No socket code in this file.
// Every action that checks-then-writes runs inside ONE database transaction.
const v = require('./validate');

const PEOPLE = ['batman', 'cinderella'];
const now = () => new Date().toISOString();

function createStore(db) {
  const q = (o) => ({ one: (s, ...p) => o.get(s, p), all: (s, ...p) => o.all(s, p), run: (s, ...p) => o.run(s, p) });
  const tx = (fn) => db.atomic((o) => fn(q(o)));

  const SUM_BAL = `SELECT COALESCE(SUM(CASE type WHEN 'withdrawal' THEN -amount ELSE amount END),0) AS n FROM transactions`;
  const SUM_ALLOC = `SELECT COALESCE(SUM(amount),0) AS n FROM goal_allocations`;
  const balanceOf = async (t) => (await t.one(SUM_BAL)).n;
  const freeOf = async (t) => (await t.one(SUM_BAL)).n - (await t.one(SUM_ALLOC)).n;
  const goalSaved = async (t, id) => (await t.one(`SELECT COALESCE(SUM(amount),0) AS n FROM goal_allocations WHERE goal_id = ?`, id)).n;
  const exists = async (t, table, id) => !!(await t.one(`SELECT 1 AS x FROM ${table} WHERE id = ?`, id));

  // ---------- secrecy: the ONLY place wishlist rows are filtered ----------
  const canSee = (row, me) => !row.is_secret || row.owner === me;
  async function wishFor(t, idv, me) {
    const row = await t.one(`SELECT * FROM wishlist WHERE id = ?`, idv);
    if (!row || !canSee(row, me)) v.fail('That wish is not here anymore'); // same message whether missing or secret
    return row;
  }
  const wishOut = (r) => ({
    id: r.id, name: r.name, price: r.price, note: r.note, status: r.status,
    addedBy: r.added_by, secret: !!r.is_secret, boughtPrice: r.bought_price,
    boughtAt: r.bought_at, createdAt: r.created_at
  });

  // ---------- snapshots: ONE round trip, built per person ----------
  async function snapshots(people) {
    const [bal, alloc, txs, wishes, goals, mems, msg] = await db.batchRead([
      [SUM_BAL], [SUM_ALLOC],
      [`SELECT id, type, amount, person, note, corrects_id AS correctsId, created_at AS createdAt
        FROM transactions ORDER BY created_at DESC, rowid DESC LIMIT 1000`],
      [`SELECT * FROM wishlist ORDER BY created_at DESC`],
      [`SELECT g.id, g.name, g.target, g.description, g.status, g.created_by AS createdBy,
          COALESCE((SELECT SUM(amount) FROM goal_allocations WHERE goal_id = g.id),0) AS saved
        FROM goals g ORDER BY g.created_at ASC`],
      [`SELECT id, note, mem_date AS date, person, created_at AS createdAt FROM memories ORDER BY mem_date DESC, created_at DESC`],
      [`SELECT value, updated_by, updated_at FROM kv WHERE key = 'message'`]
    ]);
    const b = bal[0].n, a = alloc[0].n, m = msg[0];
    const out = {};
    for (const me of people) {
      const mine = wishes.filter((r) => canSee(r, me)).map(wishOut);
      out[me] = {
        me, balance: b, allocated: a, free: b - a, transactions: txs,
        wishlist: mine.filter((w) => w.status !== 'bought'),
        bought: mine.filter((w) => w.status === 'bought').sort((x, y) => (y.boughtAt || '').localeCompare(x.boughtAt || '')),
        goals, memories: mems,
        message: m ? { text: m.value, by: m.updated_by, at: m.updated_at } : null,
        serverTime: now()
      };
    }
    return out;
  }
  const snapshot = async (me) => (await snapshots([me]))[me];
  const balance = () => db.get(SUM_BAL).then((r) => r.n);
  const free = async () => (await db.get(SUM_BAL)).n - (await db.get(SUM_ALLOC)).n;

  // ---------- savings ----------
  const insertTx = (t, me, { id, type, amount, note, correctsId = null }) =>
    t.run(`INSERT INTO transactions (id,type,amount,person,note,corrects_id,created_at) VALUES (?,?,?,?,?,?,?)`,
      id, type, amount, me, note, correctsId, now());

  async function addTx(me, p) {
    const id = v.id(p.id);
    const type = v.oneOf(p.type, ['deposit', 'withdrawal'], 'type');
    const amount = v.rupees(p.amount);
    const note = v.text(p.note, { max: 140, label: 'the note' });
    return tx(async (t) => {
      if (await exists(t, 'transactions', id)) return { duplicate: true }; // retry after a reconnect: already saved
      if (type === 'withdrawal') {
        const bal = await balanceOf(t), fr = await freeOf(t);
        if (amount > bal) v.fail(`We only have ₹${bal} saved`);
        if (amount > fr) v.fail(`Only ₹${fr} is free. The rest is set aside for a dream. Release some first`);
      }
      await insertTx(t, me, { id, type, amount, note });
      return {};
    });
  }

  async function adjustTx(me, p) {
    const id = v.id(p.id), correctsId = v.id(p.correctsId, 'entry');
    const amount = v.rupees(p.amount, { allowNegative: true, label: 'the correction' });
    const note = v.text(p.note, { max: 140, required: true, label: 'a reason for the correction' });
    return tx(async (t) => {
      if (await exists(t, 'transactions', id)) return { duplicate: true };
      if (!(await exists(t, 'transactions', correctsId))) v.fail('That diary entry does not exist');
      const fr = await freeOf(t);
      if (amount < 0 && -amount > fr) v.fail(`Only ₹${fr} is free to take off`);
      await insertTx(t, me, { id, type: 'adjustment', amount, note, correctsId });
      return {};
    });
  }

  // ---------- wishlist ----------
  async function addWish(me, p) {
    const id = v.id(p.id);
    const name = v.text(p.name, { max: 80, required: true, label: 'a name' });
    const price = v.rupees(p.price ?? 0, { min: 0, label: 'the price' });
    const note = v.text(p.note, { max: 300, label: 'the note' });
    const secret = v.bool(p.secret), t0 = now();
    return tx(async (t) => {
      if (await exists(t, 'wishlist', id)) return { duplicate: true };
      await t.run(`INSERT INTO wishlist (id,name,price,note,status,added_by,is_secret,owner,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        id, name, price, note, 'dreaming', me, secret ? 1 : 0, secret ? me : null, t0, t0);
      return {};
    });
  }

  async function updateWish(me, p) {
    const idv = v.id(p.id);
    return tx(async (t) => {
      const row = await wishFor(t, idv, me);
      if (row.status === 'bought') {
        // A bought item is frozen, except its owner can still reveal a secret gift.
        if (p.secret === false && row.is_secret) {
          await t.run(`UPDATE wishlist SET is_secret=0, owner=NULL, updated_at=? WHERE id=?`, now(), row.id);
          return {};
        }
        v.fail('That one is already bought');
      }
      const name = v.text(p.name ?? row.name, { max: 80, required: true, label: 'a name' });
      const price = v.rupees(p.price ?? row.price, { min: 0, label: 'the price' });
      const note = v.text(p.note ?? row.note, { max: 300, label: 'the note' });
      const status = v.oneOf(p.status ?? row.status, ['dreaming', 'saving'], 'status');
      let isSecret = row.is_secret, owner = row.owner;
      if (p.secret === true && !row.is_secret) { isSecret = 1; owner = me; }   // hide it (I become its keeper)
      if (p.secret === false && row.is_secret) { isSecret = 0; owner = null; } // reveal (wishFor proved I own it)
      await t.run(`UPDATE wishlist SET name=?,price=?,note=?,status=?,is_secret=?,owner=?,updated_at=? WHERE id=?`,
        name, price, note, status, isSecret, owner, now(), row.id);
      return {};
    });
  }

  async function deleteWish(me, p) {
    const idv = v.id(p.id);
    return tx(async (t) => {
      const row = await wishFor(t, idv, me);
      if (row.status === 'bought') v.fail('Bought things stay in our memories');
      await t.run(`DELETE FROM wishlist WHERE id = ?`, row.id);
      return {};
    });
  }

  async function buyWish(me, p) {
    const idv = v.id(p.id);
    const price = v.rupees(p.price, { min: 0, label: 'the price' });
    const record = v.bool(p.recordWithdrawal);
    return tx(async (t) => {
      const row = await wishFor(t, idv, me);
      if (row.status === 'bought') return { duplicate: true };
      if (record && price > 0) {
        const txId = v.id(p.txId, 'transaction id');
        const bal = await balanceOf(t), fr = await freeOf(t);
        if (price > bal) v.fail(`We only have ₹${bal} saved`);
        if (price > fr) v.fail(`Only ₹${fr} is free. The rest is set aside for a dream`);
        // A secret gift must not leak its name into the shared diary.
        const note = row.is_secret ? 'A little surprise' : `Bought: ${row.name}`.slice(0, 140);
        await insertTx(t, me, { id: txId, type: 'withdrawal', amount: price, note });
      }
      await t.run(`UPDATE wishlist SET status='bought', bought_price=?, bought_at=?, updated_at=? WHERE id=?`, price, now(), now(), row.id);
      return {};
    });
  }

  // ---------- goals ----------
  async function addGoal(me, p) {
    const id = v.id(p.id);
    const name = v.text(p.name, { max: 80, required: true, label: 'a goal name' });
    const target = v.rupees(p.target, { label: 'the target' });
    const description = v.text(p.description, { max: 300, label: 'the description' });
    return tx(async (t) => {
      if (await exists(t, 'goals', id)) return { duplicate: true };
      await t.run(`INSERT INTO goals (id,name,target,description,created_by,created_at) VALUES (?,?,?,?,?,?)`, id, name, target, description, me, now());
      return {};
    });
  }
  const goalRow = async (t, idv) => (await t.one(`SELECT * FROM goals WHERE id = ?`, idv)) || v.fail('That dream is not here anymore');

  async function updateGoal(me, p) {
    const idv = v.id(p.id, 'goal');
    return tx(async (t) => {
      const g = await goalRow(t, idv);
      await t.run(`UPDATE goals SET name=?,target=?,description=?,status=? WHERE id=?`,
        v.text(p.name ?? g.name, { max: 80, required: true, label: 'a goal name' }),
        v.rupees(p.target ?? g.target, { label: 'the target' }),
        v.text(p.description ?? g.description, { max: 300, label: 'the description' }),
        v.oneOf(p.status ?? g.status, ['active', 'reached', 'archived'], 'status'), g.id);
      return {};
    });
  }

  async function allocate(me, p) {
    const id = v.id(p.id), goalId = v.id(p.goalId, 'goal');
    const amount = v.rupees(p.amount, { allowNegative: true });
    return tx(async (t) => {
      if (await exists(t, 'goal_allocations', id)) return { duplicate: true };
      const g = await goalRow(t, goalId);
      if (amount > 0) { const fr = await freeOf(t); if (amount > fr) v.fail(`Only ₹${fr} is free to set aside`); }
      if (amount < 0) { const sv = await goalSaved(t, g.id); if (-amount > sv) v.fail(`Only ₹${sv} is in this dream`); }
      await t.run(`INSERT INTO goal_allocations (id,goal_id,amount,person,created_at) VALUES (?,?,?,?,?)`, id, g.id, amount, me, now());
      return {};
    });
  }

  // Spend money from a dream: releases it AND records the withdrawal, in one step.
  async function spendGoal(me, p) {
    const id = v.id(p.id), txId = v.id(p.txId, 'transaction id'), goalId = v.id(p.goalId, 'goal');
    const amount = v.rupees(p.amount);
    return tx(async (t) => {
      if (await exists(t, 'transactions', txId)) return { duplicate: true };
      const g = await goalRow(t, goalId);
      const note = v.text(p.note || `For: ${g.name}`, { max: 140, label: 'the note' });
      const sv = await goalSaved(t, g.id);
      if (amount > sv) v.fail(`Only ₹${sv} is in this dream`);
      await t.run(`INSERT INTO goal_allocations (id,goal_id,amount,person,created_at) VALUES (?,?,?,?,?)`, id, g.id, -amount, me, now());
      await insertTx(t, me, { id: txId, type: 'withdrawal', amount, note });
      return {};
    });
  }

  // ---------- memories + message ----------
  async function addMemory(me, p) {
    const id = v.id(p.id);
    const note = v.text(p.note, { max: 1000, required: true, label: 'a note' }), date = v.date(p.date);
    return tx(async (t) => {
      if (await exists(t, 'memories', id)) return { duplicate: true };
      await t.run(`INSERT INTO memories (id,note,mem_date,person,created_at) VALUES (?,?,?,?,?)`, id, note, date, me, now());
      return {};
    });
  }
  async function deleteMemory(me, p) {
    await db.run(`DELETE FROM memories WHERE id = ?`, [v.id(p.id)]);
    return {};
  }
  async function setMessage(me, p) {
    const text = v.text(p.text, { max: 140, label: 'the message' });
    await db.run(`INSERT INTO kv (key,value,updated_by,updated_at) VALUES ('message',?,?,?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_by=excluded.updated_by, updated_at=excluded.updated_at`,
      [text, me, now()]);
    return {};
  }

  return { PEOPLE, snapshot, snapshots, balance, free, addTx, adjustTx, addWish, updateWish, deleteWish, buyWish,
           addGoal, updateGoal, allocate, spendGoal, addMemory, deleteMemory, setMessage };
}

module.exports = { createStore };
