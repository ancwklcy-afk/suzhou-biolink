const TYPES = ['能力', '需求', '资源'];
const COOKIE = '__Host-biolink';
const TTL = 7 * 86400;
const encoder = new TextEncoder();
const schema = [
  'CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, salt TEXT NOT NULL, password TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires)',
  'CREATE TABLE IF NOT EXISTS cards (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), type TEXT NOT NULL, title TEXT NOT NULL, detail TEXT NOT NULL, shared INTEGER NOT NULL, created INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS cards_owner ON cards(user_id, created)',
  'CREATE INDEX IF NOT EXISTS cards_shared ON cards(shared, created)',
  'CREATE TABLE IF NOT EXISTS auth_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS limits_expiry ON auth_limits(expires)',
];
let initialized = false;

function json(data, status = 200, headers = {}) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });
}
function hex(bytes) { return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(''); }
function random(bytes) { return hex(crypto.getRandomValues(new Uint8Array(bytes))); }
async function digest(text) { return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)))); }
async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: encoder.encode(salt), iterations: 100000 }, key, 256);
  return hex(new Uint8Array(bits));
}
function equal(a, b) {
  let difference = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ (b.charCodeAt(i) || 0);
  return difference === 0;
}
function cookie(value, age) {
  return `${COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${age}`;
}
function token(request) {
  const value = (request.headers.get('Cookie') || '').match(/(?:^|;\s*)__Host-biolink=([a-f0-9]{64})(?:;|$)/);
  return value?.[1];
}
async function body(request) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new Error('bad-body');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('bad-body');
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 8192) { await reader.cancel(); throw new Error('bad-body'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const parsed = JSON.parse(new TextDecoder().decode(bytes));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('bad-body');
  return parsed;
}
function clean(value) { return typeof value === 'string' ? value.trim() : ''; }
async function allowAuth(db, request, name, action, now) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const keys = await Promise.all([digest(`ip:${action}:${ip}`), digest(`name:${action}:${name}`)]);
  const queries = keys.map(key => db.prepare(`INSERT INTO auth_limits VALUES (?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET count = CASE WHEN expires <= ? THEN 1 ELSE count + 1 END,
    expires = CASE WHEN expires <= ? THEN excluded.expires ELSE expires END RETURNING count`).bind(key, now + 900, now, now));
  const [ipCount, nameCount] = await db.batch(queries);
  return ipCount.results[0].count <= (action === 'register' ? 8 : 30) && nameCount.results[0].count <= 12;
}
async function authenticate(db, request, data, action, now) {
  const name = clean(data.name).toLowerCase();
  const password = typeof data.password === 'string' ? data.password : '';
  if (!/^[a-z0-9_]{3,32}$/.test(name) || password.length < 10 || password.length > 128) {
    return json({ error: '用户名需为 3–32 位英文字母、数字或下划线，密码需为 10–128 个字符。' }, 400);
  }
  if (!await allowAuth(db, request, name, action, now)) return json({ error: '操作过于频繁，请在 15 分钟后重试。' }, 429);
  let user;
  if (action === 'register') {
    const salt = random(16);
    user = { id: crypto.randomUUID(), name };
    const passwordDigest = await passwordHash(password, salt);
    const inserted = await db.prepare('INSERT INTO users VALUES (?, ?, ?, ?) ON CONFLICT(name) DO NOTHING').bind(user.id, name, salt, passwordDigest).run();
    if (!inserted.meta.changes) return json({ error: '此用户名已被使用。' }, 409);
  } else {
    user = await db.prepare('SELECT id, name, salt, password FROM users WHERE name = ?').bind(name).first();
    const attempt = await passwordHash(password, user?.salt || '0'.repeat(32));
    if (!equal(attempt, user?.password || '0'.repeat(64)) || !user) return json({ error: '用户名或密码有误。' }, 401);
  }
  const secret = random(32);
  await db.batch([
    db.prepare('DELETE FROM sessions WHERE expires <= ?').bind(now),
    db.prepare('DELETE FROM auth_limits WHERE expires <= ?').bind(now),
    db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').bind(await digest(secret), user.id, now + TTL),
  ]);
  return json({ name: user.name }, 200, { 'Set-Cookie': cookie(secret, TTL) });
}

function tokens(text) {
  const words = text.toLowerCase().match(/[a-z0-9]{2,}|[\p{Script=Han}]+/gu) || [];
  return [...new Set(words.flatMap(word => /^[a-z0-9]/.test(word) ? [word] : [...word].slice(1).map((c, i) => word[i] + c)))];
}
const common = new Set(tokens('可以 怎么 帮我 请问 有哪 哪些 什么 有没有 有没 我想 寻找 匹配 对接 相关 适合 资源 需求 能力 项目 合作 介绍 请你 提供 查看 全部 我的'));
function answer(question, rows, user) {
  const ownOnly = /我的|我提交|我录入/.test(question);
  const pool = ownOnly ? rows.filter(card => card.user_id === user.id) : rows;
  const mentioned = TYPES.filter(type => question.includes(type));
  const keywords = question.replace(/有没有|有哪些|有无|能不能|帮我|请问|请列出|查找|看看|我提交的|我录入的|我的|所有|全部|已共享的|已共享|以及|相关的|相关|资源|能力|需求|可以|吗|呢/g, ' ');
  const query = tokens(keywords).filter(term => !common.has(term));
  const overview = /概览|汇总|多少|已提交/.test(question);
  if (!pool.length) return { text: '目前没有可查询的资料。先提交一条能力、需求或资源，再来提问。', sources: [] };
  if (overview) {
    const counts = TYPES.map(type => `${type} ${pool.filter(card => card.type === type).length} 条`).join('、');
    return { text: `${ownOnly ? '你的' : '当前可查询的'}近期资料包括${counts}。你可以继续问某个方向，例如「有哪些临床前能力？」`, sources: [] };
  }
  const category = mentioned.length === 1 && !/匹配|对接/.test(question) ? mentioned[0] : '';
  const ranked = pool.filter(card => !category || card.type === category).map(card => {
    const title = card.title.toLowerCase();
    const detail = card.detail.toLowerCase();
    const score = query.reduce((sum, term) => sum + (title.includes(term) ? 3 : detail.includes(term) ? 1 : 0), 0);
    return { card, score };
  }).filter(item => !query.length || item.score > 0).sort((a, b) => b.score - a.score || b.card.created - a.card.created);
  if (!ranked.length) return { text: '现有资料里没有找到相符的条目。可以换一个更具体的关键词，或提交一条相关资料后再问。', sources: [] };
  const sources = ranked.slice(0, 5).map(({ card }) => ({
    id: card.id, type: card.type, title: card.title, detail: card.detail, own: card.user_id === user.id, shared: Boolean(card.shared),
  }));
  return { text: `找到 ${ranked.length} 条${category || '相关'}资料，先展示 ${sources.length} 条。请结合资料说明判断是否适合对接。`, sources };
}

async function api(request, db, path) {
  const now = Math.floor(Date.now() / 1000);
  const url = new URL(request.url);
  if (request.method === 'POST' && request.headers.get('Origin') !== url.origin) return json({ error: '请求来源无效。' }, 403);
  if (!initialized) {
    await db.batch(schema.map(sql => db.prepare(sql)));
    initialized = true;
  }
  if (request.method === 'POST' && ['/api/register', '/api/login'].includes(path)) {
    return authenticate(db, request, await body(request), path.split('/').pop(), now);
  }
  const secret = token(request);
  const hashed = secret ? await digest(secret) : null;
  const user = hashed && await db.prepare('SELECT users.id, users.name FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token = ? AND sessions.expires > ?').bind(hashed, now).first();
  if (!user) return json({ error: '请先登录。' }, 401);
  if (path === '/api/me' && request.method === 'GET') return json({ name: user.name });
  if (request.method !== 'POST') return json({ error: '该操作不可用。' }, 405);
  if (path === '/api/logout') {
    await db.prepare('DELETE FROM sessions WHERE token = ?').bind(hashed).run();
    return json({ ok: true }, 200, { 'Set-Cookie': cookie('', 0) });
  }
  const data = await body(request);
  if (path === '/api/cards') {
    const type = clean(data.type), title = clean(data.title), detail = clean(data.detail);
    if (!TYPES.includes(type) || !title || title.length > 60 || !detail || detail.length > 1000) return json({ error: '请选分类，填写标题（最多 60 字）和说明（最多 1000 字）。' }, 400);
    const count = await db.prepare('SELECT COUNT(*) AS total FROM cards WHERE user_id = ?').bind(user.id).first();
    if (count.total >= 300) return json({ error: '当前账号已达到 300 条资料上限。' }, 409);
    await db.prepare('INSERT INTO cards VALUES (?, ?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), user.id, type, title, detail, data.shared === true ? 1 : 0, now).run();
    return json({ ok: true }, 201);
  }
  if (path === '/api/unshare') {
    const result = await db.prepare('UPDATE cards SET shared = 0 WHERE id = ? AND user_id = ?').bind(clean(data.id), user.id).run();
    return result.meta.changes ? json({ ok: true }) : json({ error: '未找到你的这条资料。' }, 404);
  }
  if (path === '/api/ask') {
    const question = clean(data.question);
    if (!question || question.length > 300) return json({ error: '请输入 1–300 字的问题。' }, 400);
    const result = await db.batch([
      db.prepare('SELECT * FROM cards WHERE user_id = ? ORDER BY created DESC LIMIT 300').bind(user.id),
      db.prepare('SELECT * FROM cards WHERE shared = 1 AND user_id <> ? ORDER BY created DESC LIMIT 500').bind(user.id),
    ]);
    return json(answer(question, result.flatMap(item => item.results), user));
  }
  return json({ error: '该操作不可用。' }, 404);
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (!env.DB) return json({ error: '资料服务暂不可用，请稍后重试。' }, 503);
    try {
      return await api(request, env.DB, path);
    } catch (error) {
      if (error instanceof SyntaxError || error.message === 'bad-body') return json({ error: '请求内容无效。' }, 400);
      return json({ error: '服务暂不可用，请稍后重试。' }, 500);
    }
  },
};
