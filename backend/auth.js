// Identity = "who you picked" + "the code only you two know". Codes live in env vars on the server only.
const crypto = require('crypto');

const TOKEN_DAYS = 90;
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();

function loadConfig(env = process.env) {
  const cfg = {
    codes: { batman: env.BATMAN_CODE || '', cinderella: env.CINDERELLA_CODE || '' },
    secret: env.SESSION_SECRET || ''
  };
  const problems = [];
  if (cfg.codes.batman.length < 6) problems.push('BATMAN_CODE must be at least 6 characters');
  if (cfg.codes.cinderella.length < 6) problems.push('CINDERELLA_CODE must be at least 6 characters');
  if (cfg.codes.batman && cfg.codes.batman === cfg.codes.cinderella) problems.push('the two codes must be different');
  if (cfg.secret.length < 24) problems.push('SESSION_SECRET must be at least 24 characters');
  if (problems.length) throw new Error('Bad configuration: ' + problems.join('; '));
  return cfg;
}

function createAuth(cfg) {
  const sign = (body) => crypto.createHmac('sha256', cfg.secret).update(body).digest('base64url');

  function checkCode(who, code) {
    if (!Object.prototype.hasOwnProperty.call(cfg.codes, who) || typeof code !== 'string') return false;
    // compare fixed-length hashes in constant time
    return crypto.timingSafeEqual(sha(code), sha(cfg.codes[who]));
  }
  function issueToken(who) {
    const body = Buffer.from(JSON.stringify({ w: who, exp: Date.now() + TOKEN_DAYS * 864e5 })).toString('base64url');
    return `${body}.${sign(body)}`;
  }
  function verifyToken(token) {
    if (typeof token !== 'string' || token.length > 300) return null;
    const [body, sig] = token.split('.');
    if (!body || !sig) return null;
    const a = Buffer.from(sig), b = Buffer.from(sign(body));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    try {
      const { w, exp } = JSON.parse(Buffer.from(body, 'base64url').toString());
      return (w in cfg.codes) && exp > Date.now() ? w : null;
    } catch { return null; }
  }
  return { checkCode, issueToken, verifyToken };
}

// Tiny in-memory limiter: max `limit` hits per `windowMs` per key.
function createLimiter(limit, windowMs) {
  const hits = new Map();
  return (key) => {
    const t = Date.now();
    const h = hits.get(key);
    if (!h || h.reset < t) { hits.set(key, { n: 1, reset: t + windowMs }); return true; }
    h.n += 1;
    if (hits.size > 5000) for (const [k, x] of hits) if (x.reset < t) hits.delete(k);
    return h.n <= limit;
  };
}

module.exports = { loadConfig, createAuth, createLimiter };
