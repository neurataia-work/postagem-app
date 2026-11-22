// Agendador: verifica a cada 30 s os posts cuja hora chegou e publica-os em cada rede
const path = require('path');
const db = require('./db');
const providers = require('./providers');
const { getToken, parse } = require('./accounts');

const UPLOADS = path.join(__dirname, '..', 'uploads');
const publicUrl = () => (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');

function resolveMedia(post) {
  return JSON.parse(post.media || '[]').map(m => ({
    ...m, path: path.join(UPLOADS, m.file), url: `${publicUrl()}/uploads/${encodeURIComponent(m.file)}`,
  }));
}

async function publishTarget(post, target) {
  const account = parse(db.prepare('SELECT * FROM accounts WHERE id=?').get(target.account_id));
  const p = account && providers[account.network];
  try {
    if (!p) throw new Error('Conta removida ou rede desconhecida');
    const token = p.demo ? null : await getToken(account);
    const text = target.custom_content ?? post.content;
    const res = await p.publish({ account, token, text, media: resolveMedia(post) });
    db.prepare(`UPDATE post_targets SET status='published', external_id=?, url=?, error=NULL, attempts=attempts+1, published_at=? WHERE id=?`)
      .run(res.external_id || null, res.url || null, Date.now(), target.id);
  } catch (e) {
    console.error(`[publicar] post ${post.id} → ${account?.network}:`, e.message);
    db.prepare(`UPDATE post_targets SET status='failed', error=?, attempts=attempts+1 WHERE id=?`).run(e.message, target.id);
  }
}

function refreshPostStatus(postId) {
  const rows = db.prepare('SELECT status FROM post_targets WHERE post_id=?').all(postId);
  const ok = rows.filter(r => r.status === 'published').length;
  const status = rows.length && ok === rows.length ? 'published' : ok ? 'partial' : 'failed';
  db.prepare('UPDATE posts SET status=?, updated_at=? WHERE id=?').run(status, Date.now(), postId);
  return status;
}

async function publishPost(postId) {
  // "trava" o post para não ser publicado duas vezes
  const lock = db.prepare(`UPDATE posts SET status='publishing', updated_at=? WHERE id=? AND status IN ('scheduled','failed','partial','draft')`).run(Date.now(), postId);
  if (!lock.changes) return null;
  const post = db.prepare('SELECT * FROM posts WHERE id=?').get(postId);
  const targets = db.prepare(`SELECT * FROM post_targets WHERE post_id=? AND status!='published'`).all(postId);
  await Promise.all(targets.map(t => publishTarget(post, t)));
  return refreshPostStatus(postId);
}

let running = false;
async function tick() {
  if (running) return;
  running = true;
  try {
    const due = db.prepare(`SELECT id FROM posts WHERE status='scheduled' AND scheduled_at <= ? ORDER BY scheduled_at LIMIT 20`).all(Date.now());
    for (const { id } of due) await publishPost(id);
  } catch (e) { console.error('[agendador]', e); }
  finally { running = false; }
}

async function refreshMetrics() {
  const since = Date.now() - 30 * 24 * 3600 * 1000;
  const rows = db.prepare(`SELECT t.*, m.impressions, m.likes, m.comments, m.shares, m.clicks
    FROM post_targets t LEFT JOIN metrics m ON m.target_id=t.id
    WHERE t.status='published' AND t.published_at > ?`).all(since);
  for (const t of rows) {
    const account = parse(db.prepare('SELECT * FROM accounts WHERE id=?').get(t.account_id));
    const p = account && providers[account.network];
    if (!p?.metrics || !t.external_id) continue;
    try {
      const token = p.demo ? null : await getToken(account);
      const m = await p.metrics({ account, token, external_id: t.external_id, previous: t });
      db.prepare(`INSERT INTO metrics (target_id, impressions, likes, comments, shares, clicks, fetched_at) VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(target_id) DO UPDATE SET impressions=excluded.impressions, likes=excluded.likes, comments=excluded.comments,
        shares=excluded.shares, clicks=excluded.clicks, fetched_at=excluded.fetched_at`)
        .run(t.id, m.impressions || 0, m.likes || 0, m.comments || 0, m.shares || 0, m.clicks || 0, Date.now());
    } catch (e) { console.error(`[métricas] alvo ${t.id}:`, e.message); }
  }
}

function start() {
  // recupera posts que ficaram a meio se o servidor foi reiniciado
  db.prepare(`UPDATE posts SET status='scheduled' WHERE status='publishing'`).run();
  setInterval(tick, 30 * 1000);
  setInterval(refreshMetrics, (Number(process.env.METRICS_INTERVAL_MIN) || 30) * 60 * 1000);
  setTimeout(tick, 2000);
  console.log('Agendador ativo (verifica a cada 30 s)');
}

module.exports = { start, tick, publishPost, refreshMetrics, refreshPostStatus };
