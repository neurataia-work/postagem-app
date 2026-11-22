require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const db = require('./src/db');
const providers = require('./src/providers');
const { saveAccount } = require('./src/accounts');
const scheduler = require('./src/scheduler');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const UPLOADS = path.join(__dirname, 'uploads');

// Os ficheiros de media têm de ser públicos (o Instagram/TikTok vão buscá-los por URL)
app.use('/uploads', express.static(UPLOADS, { maxAge: '7d' }));

// Proteção simples por palavra-passe (recomendado assim que estiver online)
if (process.env.APP_PASSWORD) {
  app.use((req, res, next) => {
    if (req.path.startsWith('/auth/') && req.path.endsWith('/callback')) return next();
    const [, b64] = (req.headers.authorization || '').split(' ');
    const [, pass] = Buffer.from(b64 || '', 'base64').toString().split(':');
    if (pass === process.env.APP_PASSWORD) return next();
    res.set('WWW-Authenticate', 'Basic realm="Postagem"').status(401).send('Autenticação necessária');
  });
}
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS,
    filename: (req, f, cb) => cb(null, Date.now() + '-' + crypto.randomBytes(4).toString('hex') + path.extname(f.originalname).toLowerCase()),
  }),
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, f, cb) => cb(null, /^(image|video)\//.test(f.mimetype)),
});

const wrap = fn => (req, res) => Promise.resolve(fn(req, res)).catch(e => {
  console.error(e); res.status(400).json({ error: e.message });
});

// ---------- Redes e contas ----------
app.get('/api/networks', (req, res) => {
  res.json(Object.values(providers).map(p => ({
    id: p.id, label: p.label, color: p.color, charLimit: p.charLimit,
    requiresMedia: !!p.requiresMedia, configured: p.configured(), demo: !!p.demo,
  })));
});

app.get('/api/accounts', (req, res) => {
  res.json(db.prepare('SELECT id, network, name, avatar, expires_at, created_at FROM accounts ORDER BY network, name').all());
});

app.post('/api/accounts/demo', wrap((req, res) => {
  const name = (req.body.name || 'Conta demo').slice(0, 60);
  const id = saveAccount({ network: 'demo', name, external_id: 'demo-' + crypto.randomUUID() });
  res.json({ id });
}));

app.delete('/api/accounts/:id', (req, res) => {
  db.prepare('DELETE FROM accounts WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- OAuth ----------
const cbName = p => (p.connectVia || p.id);
const redirectUri = p => `${PUBLIC_URL}/auth/${cbName(p)}/callback`;

app.get('/auth/:network/start', (req, res) => {
  const p = providers[req.params.network];
  if (!p || p.demo) return res.status(404).send('Rede desconhecida');
  if (!p.configured()) return res.status(400).send(`Faltam as credenciais de ${p.label} no ficheiro .env`);
  const state = crypto.randomBytes(16).toString('hex');
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  db.prepare('INSERT INTO oauth_states (state, network, verifier, created_at) VALUES (?,?,?,?)').run(state, p.id, verifier, Date.now());
  res.redirect(p.authUrl({ state, challenge, redirectUri: redirectUri(p) }));
});

app.get('/auth/:cb/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;
  if (error) return res.redirect('/#/contas?erro=' + encodeURIComponent(error_description || error));
  const st = db.prepare('SELECT * FROM oauth_states WHERE state=?').get(state || '');
  db.prepare('DELETE FROM oauth_states WHERE state=? OR created_at < ?').run(state || '', Date.now() - 3600e3);
  if (!st) return res.redirect('/#/contas?erro=' + encodeURIComponent('Sessão de ligação expirada, tente outra vez'));
  try {
    const p = providers[st.network];
    const accounts = await p.handleCallback({ code, verifier: st.verifier, redirectUri: redirectUri(p) });
    accounts.forEach(saveAccount);
    res.redirect('/#/contas?ok=' + accounts.length);
  } catch (e) {
    console.error('[oauth]', e);
    res.redirect('/#/contas?erro=' + encodeURIComponent(e.message));
  }
});

// ---------- Media ----------
app.post('/api/upload', upload.array('files', 10), (req, res) => {
  res.json((req.files || []).map(f => ({ file: f.filename, mime: f.mimetype, name: f.originalname, size: f.size })));
});

// ---------- Posts ----------
function postWithTargets(post) {
  const targets = db.prepare(`SELECT t.id, t.account_id, t.status, t.url, t.error, t.custom_content, t.published_at,
      a.network, a.name AS account_name, m.impressions, m.likes, m.comments, m.shares, m.clicks
    FROM post_targets t LEFT JOIN accounts a ON a.id=t.account_id LEFT JOIN metrics m ON m.target_id=t.id
    WHERE t.post_id=?`).all(post.id);
  return { ...post, media: JSON.parse(post.media), targets };
}

app.get('/api/posts', (req, res) => {
  const { from, to, status } = req.query;
  let sql = 'SELECT * FROM posts WHERE 1=1';
  const args = [];
  if (from) { sql += ' AND (scheduled_at >= ? OR scheduled_at IS NULL)'; args.push(Number(from)); }
  if (to) { sql += ' AND (scheduled_at <= ? OR scheduled_at IS NULL)'; args.push(Number(to)); }
  if (status) { sql += ' AND status = ?'; args.push(status); }
  sql += ' ORDER BY COALESCE(scheduled_at, created_at) DESC LIMIT 500';
  res.json(db.prepare(sql).all(...args).map(postWithTargets));
});

function validate(body) {
  const ids = (body.account_ids || []).map(Number);
  if (!ids.length && body.action !== 'draft') throw new Error('Escolha pelo menos uma conta.');
  if (!String(body.content || '').trim() && !(body.media || []).length) throw new Error('O post está vazio.');
  const media = body.media || [];
  for (const id of ids) {
    const a = db.prepare('SELECT network, name FROM accounts WHERE id=?').get(id);
    if (!a) throw new Error('Conta inexistente: ' + id);
    const p = providers[a.network];
    const text = body.custom?.[id] ?? body.content ?? '';
    if (text.length > p.charLimit) throw new Error(`${p.label} (${a.name}): o texto tem ${text.length} caracteres, o limite é ${p.charLimit}.`);
    if (p.requiresMedia && !media.length) throw new Error(`${p.label} exige imagem ou vídeo.`);
  }
  if (body.action === 'schedule') {
    if (!body.scheduled_at) throw new Error('Escolha a data e hora.');
    if (Number(body.scheduled_at) < Date.now() - 60e3) throw new Error('A data escolhida já passou.');
  }
  return ids;
}

function savePost(id, body) {
  const ids = validate(body);
  const now = Date.now();
  const status = body.action === 'draft' ? 'draft' : 'scheduled';
  const when = body.action === 'now' ? now : (body.scheduled_at ? Number(body.scheduled_at) : null);
  const media = JSON.stringify(body.media || []);
  if (id) {
    const cur = db.prepare('SELECT status FROM posts WHERE id=?').get(id);
    if (!cur) throw new Error('Post não encontrado');
    if (['published', 'publishing'].includes(cur.status)) throw new Error('Este post já foi publicado e não pode ser editado.');
    db.prepare('UPDATE posts SET content=?, media=?, scheduled_at=?, status=?, updated_at=? WHERE id=?').run(body.content || '', media, when, status, now, id);
    db.prepare(`DELETE FROM post_targets WHERE post_id=? AND status!='published'`).run(id);
  } else {
    id = Number(db.prepare('INSERT INTO posts (content, media, scheduled_at, status, created_at, updated_at) VALUES (?,?,?,?,?,?)')
      .run(body.content || '', media, when, status, now, now).lastInsertRowid);
  }
  const ins = db.prepare('INSERT INTO post_targets (post_id, account_id, custom_content) VALUES (?,?,?)');
  for (const aid of ids) ins.run(id, aid, body.custom?.[aid] ?? null);
  return id;
}

app.post('/api/posts', wrap(async (req, res) => {
  const id = savePost(null, req.body);
  if (req.body.action === 'now') await scheduler.publishPost(id);
  res.json(postWithTargets(db.prepare('SELECT * FROM posts WHERE id=?').get(id)));
}));

app.put('/api/posts/:id', wrap(async (req, res) => {
  const id = savePost(Number(req.params.id), req.body);
  if (req.body.action === 'now') await scheduler.publishPost(id);
  res.json(postWithTargets(db.prepare('SELECT * FROM posts WHERE id=?').get(id)));
}));

// Mover no calendário (arrastar e largar)
app.patch('/api/posts/:id/reschedule', wrap((req, res) => {
  const when = Number(req.body.scheduled_at);
  if (!when || when < Date.now() - 60e3) throw new Error('Data inválida ou no passado.');
  const r = db.prepare(`UPDATE posts SET scheduled_at=?, updated_at=? WHERE id=? AND status IN ('scheduled','draft')`).run(when, Date.now(), req.params.id);
  if (!r.changes) throw new Error('Só é possível mover posts agendados ou rascunhos.');
  res.json({ ok: true });
}));

app.post('/api/posts/:id/retry', wrap(async (req, res) => {
  db.prepare(`UPDATE post_targets SET status='pending', error=NULL WHERE post_id=? AND status='failed'`).run(req.params.id);
  await scheduler.publishPost(Number(req.params.id));
  res.json(postWithTargets(db.prepare('SELECT * FROM posts WHERE id=?').get(req.params.id)));
}));

app.delete('/api/posts/:id', (req, res) => {
  db.prepare('DELETE FROM posts WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- Análises ----------
app.get('/api/analytics', (req, res) => {
  const days = Math.min(Number(req.query.days) || 30, 365);
  const since = Date.now() - days * 86400e3;
  const base = `FROM post_targets t JOIN accounts a ON a.id=t.account_id LEFT JOIN metrics m ON m.target_id=t.id
    WHERE t.status='published' AND t.published_at >= ?`;
  const sums = `COUNT(*) AS posts, COALESCE(SUM(m.impressions),0) AS impressions, COALESCE(SUM(m.likes),0) AS likes,
    COALESCE(SUM(m.comments),0) AS comments, COALESCE(SUM(m.shares),0) AS shares, COALESCE(SUM(m.clicks),0) AS clicks`;
  const totals = db.prepare(`SELECT ${sums} ${base}`).get(since);
  const byNetwork = db.prepare(`SELECT a.network, ${sums} ${base} GROUP BY a.network ORDER BY impressions DESC`).all(since);
  const byDay = db.prepare(`SELECT date(t.published_at/1000,'unixepoch','localtime') AS day, ${sums} ${base} GROUP BY day ORDER BY day`).all(since);
  const top = db.prepare(`SELECT t.id, p.content, a.network, a.name AS account_name, t.url, t.published_at,
      COALESCE(m.impressions,0) AS impressions, COALESCE(m.likes,0)+COALESCE(m.comments,0)+COALESCE(m.shares,0) AS engagement
    ${base.replace('JOIN accounts', 'JOIN posts p ON p.id=t.post_id JOIN accounts')} ORDER BY engagement DESC, impressions DESC LIMIT 10`).all(since);
  // Melhores horas: interações médias por dia da semana × hora (calculado no fuso do servidor)
  const heat = db.prepare(`SELECT CAST(strftime('%w', t.published_at/1000,'unixepoch','localtime') AS INTEGER) AS dow,
      CAST(strftime('%H', t.published_at/1000,'unixepoch','localtime') AS INTEGER) AS hour,
      AVG(COALESCE(m.likes,0)+COALESCE(m.comments,0)+COALESCE(m.shares,0)) AS eng, COUNT(*) AS n
    ${base} GROUP BY dow, hour`).all(since);
  const queue = db.prepare(`SELECT status, COUNT(*) AS n FROM posts GROUP BY status`).all();
  res.json({ days, totals, byNetwork, byDay, top, heat, queue });
});

app.post('/api/metrics/refresh', wrap(async (req, res) => {
  await scheduler.refreshMetrics();
  res.json({ ok: true });
}));

app.listen(PORT, () => {
  console.log(`App de postagem a correr em ${PUBLIC_URL}`);
  scheduler.start();
});
