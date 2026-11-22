// Pequeno wrapper de fetch que lança erros legíveis
async function req(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  if (!res.ok) {
    const msg = body?.error?.message || body?.error_description || body?.detail ||
      body?.message || body?.title || (typeof body?.error === 'string' ? body.error : null) || text;
    const err = new Error(`${res.status} ${String(msg).slice(0, 400)}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return { body, headers: res.headers, status: res.status };
}

const form = obj => new URLSearchParams(Object.entries(obj).filter(([, v]) => v != null));
const sleep = ms => new Promise(r => setTimeout(r, ms));

module.exports = { req, form, sleep };
