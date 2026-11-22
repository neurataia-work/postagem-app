const db = require('./db');
const providers = require('./providers');
const { encrypt, decrypt } = require('./crypto');

const parse = a => a && { ...a, meta: JSON.parse(a.meta || '{}') };

function saveAccount(acc) {
  // se a conta já existir (mesma rede + id externo) atualiza os tokens
  const ex = db.prepare('SELECT id FROM accounts WHERE network=? AND external_id=?').get(acc.network, acc.external_id);
  const vals = [acc.name, acc.avatar || null, encrypt(acc.access_token), encrypt(acc.refresh_token),
    acc.expires_at || null, JSON.stringify(acc.meta || {})];
  if (ex) {
    db.prepare('UPDATE accounts SET name=?, avatar=?, access_token=?, refresh_token=?, expires_at=?, meta=? WHERE id=?').run(...vals, ex.id);
    return ex.id;
  }
  return Number(db.prepare(`INSERT INTO accounts (name, avatar, access_token, refresh_token, expires_at, meta, network, external_id, created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(...vals, acc.network, acc.external_id, Date.now()).lastInsertRowid);
}

// Devolve um access token válido, renovando-o se estiver perto de expirar
async function getToken(account) {
  const p = providers[account.network];
  const soon = account.expires_at && account.expires_at < Date.now() + 5 * 60 * 1000;
  if (soon && p.refresh && account.refresh_token) {
    const t = await p.refresh({ ...account, refresh_token: decrypt(account.refresh_token) });
    db.prepare('UPDATE accounts SET access_token=?, refresh_token=?, expires_at=? WHERE id=?')
      .run(encrypt(t.access_token), encrypt(t.refresh_token || decrypt(account.refresh_token)), t.expires_at, account.id);
    return t.access_token;
  }
  if (soon && account.expires_at < Date.now()) throw new Error('O token desta conta expirou. Volte a ligar a conta.');
  return decrypt(account.access_token);
}

module.exports = { saveAccount, getToken, parse };
