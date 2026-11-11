(() => {
  const E = US.EVENTS, NAMES = US.PEOPLE;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rs = (n) => '₹' + Number(n).toLocaleString('en-IN');
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12));
  const nice = (iso) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const niceDay = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
  const rot = (i) => ['-1.2deg', '0.9deg', '-0.5deg', '1.4deg'][i % 4];

  const doodle = {
    heart: '<svg viewBox="0 0 24 22" width="1em" height="1em"><path d="M12 20C4 14 2 9.5 2 6.5 2 3.8 4 2 6.4 2c2.2 0 4 1.3 5.6 3.6C13.600 3.300 15.400 2 17.600 2 20 2 22 3.800 22 6.500c0 3-2 7.500-10 13.500z" fill="currentColor" stroke="#6b4a3a" stroke-width="1.2" stroke-linejoin="round"/></svg>',
    flower: '<svg viewBox="0 0 60 80" class="flower"><path d="M30 78C29 60 31 45 30 30" stroke="#8a9a76" stroke-width="2.500" fill="none"/><path d="M30 60c-10-2-14-8-14-12 8 0 13 5 14 12zM30 52c9-3 13-9 12-13-8 1-12 6-12 13z" fill="#a9b790"/><g fill="#e8b4b8" stroke="#b9777d" stroke-width="1"><circle cx="30" cy="12" r="8"/><circle cx="41" cy="20" r="8"/><circle cx="37" cy="33" r="8"/><circle cx="23" cy="33" r="8"/><circle cx="19" cy="20" r="8"/></g><circle cx="30" cy="22" r="6" fill="#f2d98d" stroke="#c9a54a"/></svg>',
    squiggle: '<svg viewBox="0 0 120 12" class="squiggle"><path d="M2 6c8-8 12 8 20 0s12 8 20 0 12 8 20 0 12 8 20 0 12 8 20 0" stroke="#b9777d" stroke-width="2" fill="none" stroke-linecap="round"/></svg>',
    star: '<svg viewBox="0 0 24 24" width="1em" height="1em"><path d="M12 2l2.900 6.500 7.100.7-5.300 4.800 1.500 7L12 17.300 5.800 21l1.500-7L2 9.200l7.100-.7z" fill="#f2d98d" stroke="#6b4a3a" stroke-width="1.200" stroke-linejoin="round"/></svg>'
  };

  let S = null;            // latest snapshot from the server (already filtered for ME)
  let page = 'home';
  const PAGES = ['home', 'diary', 'wishlist', 'dreams', 'memories'];

  // ---------- tiny UI helpers ----------
  let toastTimer;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
  }
  async function act(event, payload, okMsg) {
    const r = await net.send(event, payload);
    if (!r || !r.ok) { toast((r && r.error) || 'Something went wrong'); return false; }
    if (okMsg) toast(okMsg);
    return true;
  }

  // Generic paper-slip form. fields: [{name,label,type,value,placeholder,options,hint,required}]
  function openForm({ title, intro, fields, submit = 'save ♡', extra = '', onSubmit }) {
    const m = $('#modal');
    const inputs = fields.map((f) => {
      const id = 'f_' + f.name;
      let el;
      if (f.type === 'select') el = `<select id="${id}" name="${f.name}">${f.options.map(([v, l]) => `<option value="${v}" ${v === f.value ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
      else if (f.type === 'textarea') el = `<textarea id="${id}" name="${f.name}" rows="3" maxlength="${f.max || 300}" placeholder="${esc(f.placeholder || '')}">${esc(f.value || '')}</textarea>`;
      else if (f.type === 'checkbox') return `<label class="check"><input type="checkbox" name="${f.name}" ${f.value ? 'checked' : ''}> <span>${f.label}</span></label>${f.hint ? `<p class="hint">${f.hint}</p>` : ''}`;
      else el = `<input id="${id}" name="${f.name}" type="${f.type || 'text'}" ${f.type === 'number' ? 'inputmode="numeric" min="1" step="1"' : ''} value="${esc(f.value ?? '')}" placeholder="${esc(f.placeholder || '')}" ${f.max ? `maxlength="${f.max}"` : ''} ${f.required ? 'required' : ''} autocomplete="off">`;
      return `<label class="hand" for="${id}">${f.label}</label>${el}${f.hint ? `<p class="hint">${f.hint}</p>` : ''}`;
    }).join('');
    m.innerHTML = `<div class="slip" role="dialog" aria-modal="true" aria-label="${esc(title)}"><span class="tape t-left"></span>
      <h2>${esc(title)}</h2>${intro ? `<p class="hint">${intro}</p>` : ''}
      <form>${inputs}${extra}<p class="err" role="alert"></p>
      <div class="row"><button type="button" class="btn ghost" data-close>never mind</button><button class="btn" type="submit">${submit}</button></div></form></div>`;
    m.hidden = false;
    const form = $('form', m);
    const first = $('input:not([type=checkbox]),textarea,select', form); first && setTimeout(() => first.focus(), 50);
    const close = () => { m.hidden = true; m.innerHTML = ''; };
    m.onclick = (e) => { if (e.target === m || e.target.hasAttribute('data-close')) close(); };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const data = {};
      for (const f of fields) {
        const el = form.elements[f.name];
        data[f.name] = f.type === 'checkbox' ? el.checked : el.value;
      }
      const btn = $('button[type=submit]', form); btn.disabled = true;
      const r = await onSubmit(data);
      btn.disabled = false;
      if (r === true) close(); else $('.err', form).textContent = r || '';
    };
  }
  const submitter = (event, build, okMsg) => async (d) => {
    const r = await net.send(event, build(d));
    if (r && r.ok) { if (okMsg) toast(okMsg); return true; }
    return (r && r.error) || 'Something went wrong';
  };

  // ---------- money actions ----------
  const num = (v) => (/^\s*-?\d+\s*$/.test(v) ? parseInt(v, 10) : NaN);
  function moneyForm(type) {
    const dep = type === 'deposit';
    openForm({
      title: dep ? 'put some money in' : 'take some money out',
      intro: dep ? 'Physical cash into our pile.' : `We have ${rs(S.free)} free to take out.`,
      fields: [
        { name: 'amount', label: 'how much? (₹)', type: 'number', required: true, placeholder: '200' },
        { name: 'note', label: 'a little note (optional)', max: 140, placeholder: dep ? 'chai money' : 'what for?' }
      ],
      submit: dep ? 'add to our pile' : 'record it',
      onSubmit: (d) => {
        const amount = num(d.amount);
        if (Number.isNaN(amount)) return 'Whole rupees only, like 250';
        return submitter(E.TX_ADD, () => ({ id: uid(), type, amount, note: d.note }), dep ? 'Added to our pile ♡' : 'Recorded in our diary')(d);
      }
    });
  }
  function adjustForm(tx) {
    openForm({
      title: 'fix a mistake',
      intro: `We never erase the diary. Instead we add a correction beside <b>${rs(tx.amount)}</b> (${esc(tx.note || tx.type)}). Use a minus to take away, e.g. -50.`,
      fields: [
        { name: 'amount', label: 'correction (₹, + or −)', type: 'text', required: true, placeholder: '-50' },
        { name: 'note', label: 'why?', required: true, max: 140, placeholder: 'it was 250, not 300' }
      ],
      submit: 'add correction',
      onSubmit: (d) => {
        const amount = num(d.amount);
        if (Number.isNaN(amount) || amount === 0) return 'Enter a whole number like -50 or 20';
        return submitter(E.TX_ADJUST, () => ({ id: uid(), correctsId: tx.id, amount, note: d.note }), 'Correction added')(d);
      }
    });
  }

  // ---------- wishlist actions ----------
  const STATUS = { dreaming: 'still dreaming', saving: 'saving for it', bought: 'bought' };
  function wishForm(w) {
    const editing = !!w;
    openForm({
      title: editing ? 'edit this wish' : 'add a wish',
      fields: [
        { name: 'name', label: 'what is it?', required: true, max: 80, value: w && w.name },
        { name: 'price', label: 'about how much? (₹)', type: 'number', value: w ? w.price : '', placeholder: '1500' },
        { name: 'note', label: 'a note (optional)', type: 'textarea', value: w && w.note, placeholder: 'why we want it…' },
        ...(editing ? [{ name: 'status', label: 'where is it?', type: 'select', value: w.status, options: [['dreaming', STATUS.dreaming], ['saving', STATUS.saving]] }] : []),
        { name: 'secret', type: 'checkbox', value: w ? w.secret : false, label: 'a secret surprise 🤫', hint: 'Only you can ever see it. It never even reaches their phone until you reveal it.' }
      ],
      onSubmit: (d) => {
        const price = d.price === '' ? 0 : num(d.price);
        if (Number.isNaN(price) || price < 0) return 'Price must be whole rupees';
        const body = { name: d.name, price, note: d.note, secret: d.secret };
        if (editing) return submitter(E.WISH_UPDATE, () => ({ ...body, id: w.id, status: d.status }), 'Saved')(d);
        return submitter(E.WISH_ADD, () => ({ ...body, id: uid() }), 'Added to our wishlist')(d);
      }
    });
  }
  function buyForm(w) {
    openForm({
      title: 'we got it! 🎉',
      intro: `<b>${esc(w.name)}</b> moves into our memories.`,
      fields: [
        { name: 'price', label: 'what did it really cost? (₹)', type: 'number', required: true, value: w.price || '' },
        { type: 'checkbox', name: 'record', label: 'also take this out of our savings', value: false,
          hint: `Nothing is deducted unless you tick this. We have ${rs(S.free)} free.` }
      ],
      submit: 'we bought it',
      onSubmit: (d) => {
        const price = num(d.price);
        if (Number.isNaN(price) || price < 0) return 'Price must be whole rupees';
        return submitter(E.WISH_BUY, () => ({ id: w.id, price, recordWithdrawal: d.record, txId: uid() }), 'Into our memories ♡')(d);
      }
    });
  }

  // ---------- goals ----------
  function goalForm(g) {
    openForm({
      title: g ? 'edit this dream' : 'a new dream',
      fields: [
        { name: 'name', label: 'what are we dreaming of?', required: true, max: 80, value: g && g.name },
        { name: 'target', label: 'how much do we need? (₹)', type: 'number', required: true, value: g && g.target },
        { name: 'description', label: 'tell the story (optional)', type: 'textarea', value: g && g.description }
      ],
      onSubmit: (d) => {
        const target = num(d.target);
        if (Number.isNaN(target)) return 'Whole rupees only';
        return g ? submitter(E.GOAL_UPDATE, () => ({ id: g.id, name: d.name, target, description: d.description }), 'Saved')(d)
                 : submitter(E.GOAL_ADD, () => ({ id: uid(), name: d.name, target, description: d.description }), 'A new dream ♡')(d);
      }
    });
  }
  function allocForm(g, mode) {
    const verbs = { add: ['set money aside', `We have ${rs(S.free)} free to set aside.`], back: ['take money back', `${rs(g.saved)} is set aside here.`], spend: ['spend from this dream', `${rs(g.saved)} is set aside here. It will also be written in our diary as a withdrawal.`] };
    openForm({
      title: verbs[mode][0], intro: verbs[mode][1],
      fields: [{ name: 'amount', label: 'how much? (₹)', type: 'number', required: true }, ...(mode === 'spend' ? [{ name: 'note', label: 'note (optional)', max: 140, placeholder: `For: ${g.name}` }] : [])],
      onSubmit: (d) => {
        const amount = num(d.amount);
        if (Number.isNaN(amount) || amount < 1) return 'Whole rupees, at least 1';
        if (mode === 'spend') return submitter(E.GOAL_SPEND, () => ({ id: uid(), txId: uid(), goalId: g.id, amount, note: d.note }), 'Spent, and written in our diary')(d);
        return submitter(E.GOAL_ALLOCATE, () => ({ id: uid(), goalId: g.id, amount: mode === 'add' ? amount : -amount }), 'Done ♡')(d);
      }
    });
  }

  function memoryForm() {
    openForm({
      title: 'remember this',
      fields: [
        { name: 'note', label: 'a small moment worth keeping', type: 'textarea', max: 1000, placeholder: 'the day we…' },
        { name: 'date', label: 'when?', type: 'date', value: today(), required: true }
      ],
      onSubmit: submitter(E.MEMORY_ADD, (d) => ({ id: uid(), note: d.note, date: d.date }), 'Pinned in our book ♡')
    });
  }

  // ---------- views ----------
  const who = (p) => (p === S.me ? 'you' : NAMES[p] || p);
  const head = (title, sub) => `<header class="head"><h1>${title}</h1>${sub ? `<p class="hand sub">${sub}</p>` : ''}${doodle.squiggle}</header>`;

  function hearts(saved, target) {
    const frac = target > 0 ? Math.min(1, saved / target) : 0, n = 10, full = Math.floor(frac * n + 1e-9);
    return `<div class="hearts" aria-label="${Math.round(frac * 100)} percent saved">${Array.from({ length: n }, (_, i) => `<span class="${i < full ? 'on' : ''}">${doodle.heart}</span>`).join('')}</div>`;
  }
  const bar = (saved, target) => `<div class="bar" role="img" aria-label="${rs(saved)} of ${rs(target)}"><i style="width:${Math.min(100, target ? (saved / target) * 100 : 0)}%"></i></div>`;

  function txRow(t, withFix) {
    const sign = t.type === 'withdrawal' ? '−' : t.amount < 0 ? '−' : '+';
    const cls = t.type === 'withdrawal' || t.amount < 0 ? 'out' : 'in';
    const label = t.type === 'adjustment' ? 'correction' : t.type === 'deposit' ? 'added' : 'took out';
    return `<li class="tx ${cls}"><span class="amt">${sign}${rs(Math.abs(t.amount))}</span>
      <span class="what"><b>${label}</b> · ${esc(who(t.person))}${t.note ? ` · <i>${esc(t.note)}</i>` : ''}<br><small>${nice(t.createdAt)}</small></span>
      ${withFix && t.type !== 'adjustment' ? `<button class="mini" data-fix="${t.id}" title="add a correction">✎ fix</button>` : ''}</li>`;
  }

  function wishCard(w, i, full) {
    const mine = w.secret;
    return `<li class="wish" style="--r:${rot(i)}">
      <span class="pin"></span>
      ${mine ? '<span class="ribbon">shh, secret 🤫</span>' : ''}
      <h3>${esc(w.name)}</h3>
      <p class="price">${w.price ? rs(w.price) : 'priceless'}</p>
      ${w.note ? `<p class="note-text">${esc(w.note)}</p>` : ''}
      <p class="meta"><span class="stamp">${STATUS[w.status]}</span> added by ${esc(who(w.addedBy))}</p>
      ${full ? `<div class="acts">
        <button class="mini" data-bought="${w.id}">✓ bought</button>
        <button class="mini" data-wedit="${w.id}">edit</button>
        ${mine ? `<button class="mini" data-reveal="${w.id}">reveal 🎁</button>` : ''}
        <button class="mini warn" data-wdel="${w.id}">remove</button></div>` : ''}
    </li>`;
  }

  function goalCard(g, i, full) {
    const reached = g.status === 'reached' || g.saved >= g.target;
    return `<article class="goal" style="--r:${rot(i + 1)}"><span class="tape t-left"></span>
      <h3>${esc(g.name)} ${reached ? '<span class="stamp ok">reached!</span>' : ''}</h3>
      ${g.description ? `<p class="note-text">${esc(g.description)}</p>` : ''}
      ${bar(g.saved, g.target)}
      <p class="goalnums"><b>${rs(g.saved)}</b> of ${rs(g.target)}</p>
      ${full ? `<div class="acts">
        <button class="mini" data-gadd="${g.id}">+ set aside</button>
        <button class="mini" data-gback="${g.id}" ${g.saved ? '' : 'disabled'}>take back</button>
        <button class="mini" data-gspend="${g.id}" ${g.saved ? '' : 'disabled'}>spend</button>
        <button class="mini" data-gedit="${g.id}">edit</button>
        ${g.status === 'active' ? `<button class="mini" data-gstatus="${g.id}:reached">mark reached</button>` : `<button class="mini" data-gstatus="${g.id}:active">reopen</button>`}
      </div>` : ''}</article>`;
  }

  const views = {
    home() {
      const goal = S.goals.find((g) => g.status === 'active');
      const msg = S.message && S.message.text;
      return `
      <div class="spread">
        <section class="sheet left">
          ${head('us &amp; ours.', new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }))}
          <div class="balance"><span class="tape t-left"></span><span class="tape t-right"></span>
            <p class="hand">our little pile</p>
            <p class="big">${rs(S.balance)}</p>
            ${S.allocated ? `<p class="small">${rs(S.free)} free · ${rs(S.allocated)} set aside for dreams</p>` : '<p class="small">saved, together</p>'}
          </div>
          <div class="progress">
            ${goal ? `<p class="hand">on the way to <b>${esc(goal.name)}</b></p>${hearts(goal.saved, goal.target)}<p class="small">${rs(goal.saved)} of ${rs(goal.target)}</p>`
                   : `<p class="hand">no dream picked yet</p><p class="small">add one on the <a href="#dreams">Our Dreams</a> page</p>`}
          </div>
          <div class="row big-actions"><button class="btn" data-money="deposit">+ add savings</button><button class="btn ghost" data-money="withdrawal">− take out</button></div>
          <div class="pinned"><span class="tape t-right"></span>
            <label class="hand" for="msg">a note for us</label>
            <textarea id="msg" rows="2" maxlength="140" placeholder="write something sweet…">${esc(msg || '')}</textarea>
            <p class="small" id="msgBy">${S.message ? `last written by ${esc(who(S.message.by))}` : 'tap to write'}</p>
          </div>
          <div class="flowers">${doodle.flower}</div>
        </section>
        <section class="sheet right">
          <h2>recent in our diary</h2>
          ${S.transactions.length ? `<ul class="txs">${S.transactions.slice(0, 5).map((t) => txRow(t)).join('')}</ul><a class="more" href="#diary">open the whole diary →</a>` : '<p class="empty">Nothing yet. Our first coin goes here ♡</p>'}
          <h2>on our wishlist</h2>
          ${S.wishlist.length ? `<ul class="wishes small-grid">${S.wishlist.slice(0, 4).map((w, i) => wishCard(w, i, false)).join('')}</ul><a class="more" href="#wishlist">see all wishes →</a>` : '<p class="empty">No wishes yet.</p>'}
          <h2>our next dream</h2>
          ${goal ? goalCard(goal, 0, false) + '<a class="more" href="#dreams">all our dreams →</a>' : '<p class="empty">Start one together.</p>'}
        </section>
      </div>`;
    },
    diary() {
      const groups = [];
      for (const t of S.transactions) {
        const day = t.createdAt.slice(0, 10);
        let g = groups[groups.length - 1];
        if (!g || g.day !== day) groups.push((g = { day, items: [] }));
        g.items.push(t);
      }
      return `<section class="sheet single">${head('Savings Diary', 'every coin, written down. nothing is ever erased')}
        <div class="row"><button class="btn" data-money="deposit">+ add savings</button><button class="btn ghost" data-money="withdrawal">− take out</button></div>
        <p class="hand total">together we have <b>${rs(S.balance)}</b></p>
        ${groups.length ? groups.map((g) => `<h3 class="day">${new Date(g.day + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</h3><ul class="txs">${g.items.map((t) => txRow(t, true)).join('')}</ul>`).join('') : '<p class="empty">The first page is still blank ♡</p>'}
      </section>`;
    },
    wishlist() {
      return `<section class="sheet single">${head('Our Wishlist', 'things we dream about')}
        <button class="btn" data-wadd>+ add a wish</button>
        ${S.wishlist.length ? `<ul class="wishes">${S.wishlist.map((w, i) => wishCard(w, i, true)).join('')}</ul>` : '<p class="empty">Nothing here yet. What are we dreaming of?</p>'}
      </section>`;
    },
    dreams() {
      return `<section class="sheet single">${head('Our Dreams', 'money we set aside for the big things')}
        <p class="hand total">free to set aside: <b>${rs(S.free)}</b></p>
        <button class="btn" data-gnew>+ a new dream</button>
        <div class="goals">${S.goals.filter((g) => g.status !== 'archived').map((g, i) => goalCard(g, i, true)).join('') || '<p class="empty">No dreams yet. Pick the first one together.</p>'}</div>
      </section>`;
    },
    memories() {
      return `<section class="sheet single">${head('Memories', 'small moments, and things we got')}
        <button class="btn" data-madd>+ remember something</button>
        <div class="notes">${S.memories.map((m, i) => `<figure class="polaroid" style="--r:${rot(i)}"><span class="tape t-left"></span>
          <blockquote>${esc(m.note)}</blockquote><figcaption>${niceDay(m.date)} · ${esc(who(m.person))}<button class="x" data-mdel="${m.id}" aria-label="remove memory">×</button></figcaption></figure>`).join('') || '<p class="empty">Our first memory goes here.</p>'}</div>
        <h2>things we got ${doodle.star}</h2>
        <div class="notes">${S.bought.map((b, i) => `<figure class="polaroid got" style="--r:${rot(i + 2)}"><span class="tape t-right"></span>
          <blockquote><b>${esc(b.name)}</b>${b.note ? `<br>${esc(b.note)}` : ''}</blockquote>
          <figcaption>${rs(b.boughtPrice)} · ${niceDay(b.boughtAt.slice(0, 10))}${b.secret ? ' · <span class="stamp">still secret 🤫</span>' : ''}${b.secret ? `<button class="mini" data-reveal="${b.id}">reveal</button>` : ''}</figcaption></figure>`).join('') || '<p class="empty">When we buy something from our wishlist, it lands here.</p>'}</div>
      </section>`;
    }
  };

  // ---------- render + events ----------
  function render() {
    if (!S) return;
    const el = $('#page');
    if (document.activeElement && document.activeElement.id === 'msg') return; // don't wipe what she's typing
    el.innerHTML = views[page]() + `<footer class="foot"><button class="link" id="logout">close the book (${esc(NAMES[S.me])})</button></footer>`;
    document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('on', a.dataset.p === page));
  }

  function route(animate) {
    const p = (location.hash || '#home').slice(1);
    page = PAGES.includes(p) ? p : 'home';
    if (animate) { const el = $('#page'); el.classList.remove('turn'); void el.offsetWidth; el.classList.add('turn'); window.scrollTo(0, 0); }
    render();
  }
  window.addEventListener('hashchange', () => route(true));

  const byId = (list, id) => list.find((x) => x.id === id);
  document.addEventListener('click', async (e) => {
    const t = e.target.closest('button,a');
    if (!t || !S) return;
    const d = t.dataset;
    if (d.money) return moneyForm(d.money);
    if (d.fix) return adjustForm(byId(S.transactions, d.fix));
    if (t.hasAttribute('data-wadd')) return wishForm();
    if (d.wedit) return wishForm(byId(S.wishlist, d.wedit));
    if (d.bought) return buyForm(byId(S.wishlist, d.bought));
    if (d.reveal) { if (confirm('Reveal this surprise to them now?')) act(E.WISH_UPDATE, { id: d.reveal, secret: false }, 'Surprise revealed 🎁'); return; }
    if (d.wdel) { if (confirm('Remove this wish?')) act(E.WISH_DELETE, { id: d.wdel }); return; }
    if (t.hasAttribute('data-gnew')) return goalForm();
    if (d.gedit) return goalForm(byId(S.goals, d.gedit));
    if (d.gadd) return allocForm(byId(S.goals, d.gadd), 'add');
    if (d.gback) return allocForm(byId(S.goals, d.gback), 'back');
    if (d.gspend) return allocForm(byId(S.goals, d.gspend), 'spend');
    if (d.gstatus) { const [id, status] = d.gstatus.split(':'); return act(E.GOAL_UPDATE, { id, status }, status === 'reached' ? 'We did it! ♡' : 'Reopened'); }
    if (t.hasAttribute('data-madd')) return memoryForm();
    if (d.mdel) { if (confirm('Remove this memory?')) act(E.MEMORY_DELETE, { id: d.mdel }); return; }
    if (t.id === 'logout') { net.logout(); S = null; showLogin(); }
  });
  document.addEventListener('focusout', (e) => {
    if (e.target.id !== 'msg' || !S) return;
    const text = e.target.value.trim();
    if ((S.message ? S.message.text : '') !== text) act(E.MESSAGE_SET, { text }, 'Pinned ♡');
    setTimeout(render, 0);
  });

  // ---------- login ----------
  let picked = null;
  function showLogin() {
    $('#book').hidden = true; $('#login').hidden = false;
    $('#code').value = ''; $('#loginErr').textContent = '';
  }
  document.querySelectorAll('.sticker').forEach((b) => b.addEventListener('click', () => {
    picked = b.dataset.who;
    document.querySelectorAll('.sticker').forEach((x) => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', on); });
    $('#code').focus();
  }));
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#loginErr'), btn = $('#loginBtn');
    if (!picked) return (err.textContent = 'Tap who you are first ♡');
    if (!$('#code').value) return (err.textContent = 'Type our secret code');
    btn.disabled = true; btn.textContent = 'opening…'; err.textContent = '';
    const wake = setTimeout(() => { err.style.color = '#8a6f5c'; err.textContent = 'Our book was napping, waking it up… this can take about a minute ♡'; }, 4000);
    const r = await net.login(picked, $('#code').value);
    clearTimeout(wake); err.style.color = '';
    btn.disabled = false; btn.textContent = 'open our book ♡';
    if (!r.ok) return (err.textContent = r.error);
    startBook();
  });

  function startBook() {
    $('#login').hidden = true; $('#book').hidden = false;
    $('#page').innerHTML = '<p class="loading hand">opening our book…</p>';
    net.connect();
  }

  net.onState((s) => { S = s; route(false); });
  net.onStatus((st) => {
    const c = $('#conn');
    c.hidden = st === 'online';
    c.textContent = st === 'connecting' ? 'opening our book… (the server may be waking up, give it a moment)' : 'lost connection. Trying to find our book again…';
  });
  net.onAuthFail(() => { S = null; showLogin(); toast('Please enter our code again'); });

  if (net.hasSession()) startBook(); else showLogin();
  route(false);
})();
