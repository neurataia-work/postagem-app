// Cifra os tokens das redes sociais em repouso (AES-256-GCM)
const crypto = require('crypto');

function key() {
  const secret = process.env.APP_SECRET || 'dev-secret-mude-isto';
  return crypto.createHash('sha256').update(secret).digest();
}

function encrypt(text) {
  if (text == null || text === '') return null;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map(b => b.toString('base64')).join('.');
}

function decrypt(payload) {
  if (!payload) return null;
  const [iv, tag, enc] = payload.split('.').map(s => Buffer.from(s, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt };
