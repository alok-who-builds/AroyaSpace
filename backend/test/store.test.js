const assert = require('assert');
const { openLocal } = require('../db');
const { createStore } = require('../store');

(async () => {
  const db = openLocal(':memory:');
  const s = createStore(db);
  const uid = (() => { let n = 0; return () => 'id' + String(++n).padStart(10, '0'); })();
  const rejects = async (p, re) => assert.rejects(p, (e) => e.isUser && re.test(e.message));
  const raw = db.raw;

  // balance is derived and shared
  await s.addTx('batman', { id: uid(), type: 'deposit', amount: 200 });
  const t2 = uid();
  await s.addTx('cinderella', { id: t2, type: 'deposit', amount: 300 });
  assert.strictEqual((await s.snapshot('batman')).balance, 500);
  // duplicate retry is harmless
  assert.ok((await s.addTx('cinderella', { id: t2, type: 'deposit', amount: 300 })).duplicate);
  assert.strictEqual(await s.balance(), 500);
  // validation
  await rejects(s.addTx('batman', { id: uid(), type: 'deposit', amount: 12.5 }), /whole/);
  await rejects(s.addTx('batman', { id: uid(), type: 'deposit', amount: -5 }), /at least/);
  await rejects(s.addTx('batman', { id: uid(), type: 'withdrawal', amount: 501 }), /only have/i);
  // adjustment, and history can never be rewritten
  await s.adjustTx('batman', { id: uid(), correctsId: t2, amount: -50, note: 'typo, it was 250' });
  assert.strictEqual(await s.balance(), 450);
  assert.throws(() => raw.exec('UPDATE transactions SET amount = 1'), /append-only/);
  assert.throws(() => raw.exec('DELETE FROM transactions'), /append-only/);
  // goals never double count
  const g = uid(); await s.addGoal('batman', { id: g, name: 'Trip', target: 1000 });
  await s.allocate('batman', { id: uid(), goalId: g, amount: 400 });
  assert.strictEqual(await s.balance(), 450); assert.strictEqual(await s.free(), 50);
  await rejects(s.allocate('batman', { id: uid(), goalId: g, amount: 100 }), /free/);
  await rejects(s.addTx('batman', { id: uid(), type: 'withdrawal', amount: 100 }), /free/);
  await s.spendGoal('batman', { id: uid(), txId: uid(), goalId: g, amount: 100 });
  assert.strictEqual(await s.balance(), 350); assert.strictEqual((await s.snapshot('batman')).goals[0].saved, 300);
  // a failed action leaves nothing half-written
  const before = await s.balance();
  await rejects(s.spendGoal('batman', { id: uid(), txId: uid(), goalId: g, amount: 9999 }), /in this dream/);
  assert.strictEqual(await s.balance(), before);
  // secrets are invisible and untouchable for the other person
  const w = uid();
  await s.addWish('batman', { id: w, name: 'Surprise ring', price: 900, secret: true });
  const pub = uid(); await s.addWish('batman', { id: pub, name: 'Headphones', price: 500 });
  assert.strictEqual((await s.snapshot('batman')).wishlist.length, 2);
  const her = await s.snapshot('cinderella');
  assert.strictEqual(her.wishlist.length, 1);
  assert.ok(!JSON.stringify(her).includes('ring'));
  await rejects(s.updateWish('cinderella', { id: w, name: 'x' }), /not here/);
  await rejects(s.deleteWish('cinderella', { id: w }), /not here/);
  await rejects(s.buyWish('cinderella', { id: w, price: 1 }), /not here/);
  // bought secret gift does not leak its name into the shared diary
  await s.buyWish('batman', { id: w, price: 40, recordWithdrawal: true, txId: uid() });
  const diary = JSON.stringify((await s.snapshot('cinderella')).transactions);
  assert.ok(!diary.includes('ring')); assert.ok(diary.includes('little surprise'));
  assert.strictEqual((await s.snapshot('cinderella')).bought.length, 0);
  // reveal
  await s.updateWish('batman', { id: w, secret: false });
  assert.strictEqual((await s.snapshot('cinderella')).bought.length, 1);
  // she can mark an item secret and then it vanishes for him
  await s.updateWish('cinderella', { id: pub, secret: true });
  assert.ok(!JSON.stringify(await s.snapshot('batman')).includes('Headphones'));
  // buy without withdrawal changes nothing in balance
  const b4 = await s.balance();
  await s.updateWish('cinderella', { id: pub, secret: false });
  await s.buyWish('batman', { id: pub, price: 450, recordWithdrawal: false });
  assert.strictEqual(await s.balance(), b4);
  // memories + message
  await s.addMemory('batman', { id: uid(), note: 'first saved coin', date: '2026-11-10' });
  await rejects(s.addMemory('batman', { id: uid(), note: 'x', date: '2026-13-40' }), /date/);
  await s.setMessage('batman', { text: 'hi love' });
  assert.strictEqual((await s.snapshot('cinderella')).message.text, 'hi love');
  // many things at once never corrupt the balance (all deposits)
  await Promise.all(Array.from({ length: 20 }, () => s.addTx('batman', { id: uid(), type: 'deposit', amount: 10 })));
  assert.strictEqual(await s.balance(), b4 + 200);
  console.log('all store tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
