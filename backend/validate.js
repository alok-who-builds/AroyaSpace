// Server-side validation. Anything the browser sends is untrusted.
class UserError extends Error {
  constructor(msg) { super(msg); this.isUser = true; }
}
const fail = (msg) => { throw new UserError(msg); };

const MAX_RUPEES = 10000000;

function text(v, { max = 200, required = false, label = 'text' } = {}) {
  if (v === undefined || v === null) v = '';
  if (typeof v !== 'string') fail(`${label} must be text`);
  v = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (required && !v) fail(`Please fill in ${label}`);
  if (v.length > max) fail(`${label} is too long (max ${max})`);
  return v;
}
function rupees(v, { min = 1, label = 'amount', allowNegative = false } = {}) {
  if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) v = Number(v);
  if (!Number.isInteger(v)) fail(`${label} must be a whole number of rupees`);
  if (Math.abs(v) > MAX_RUPEES) fail(`${label} is too large`);
  if (allowNegative) { if (v === 0) fail(`${label} can't be zero`); }
  else if (v < min) fail(min >= 1 ? `${label} must be at least ₹${min}` : `${label} can't be negative`);
  return v;
}
function id(v, label = 'id') {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(v)) fail(`bad ${label}`);
  return v;
}
function oneOf(v, list, label = 'value') {
  if (!list.includes(v)) fail(`bad ${label}`);
  return v;
}
function date(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) fail('Please pick a valid date');
  const d = new Date(v + 'T00:00:00Z');
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) fail('Please pick a valid date');
  return v;
}
function bool(v) { return v === true; }

module.exports = { UserError, fail, text, rupees, id, oneOf, date, bool, MAX_RUPEES };
