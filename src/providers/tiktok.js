// TikTok via Content Posting API (Direct Post)
// Docs: https://developers.tiktok.com/doc/content-posting-api-reference-direct-post
// Atenção: até a app passar a auditoria do TikTok, os posts só podem ser privados (SELF_ONLY).
const fs = require('fs');
const { req, form } = require('./http');
const API = 'https://open.tiktokapis.com/v2';
const json = token => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' });

async function token(params) {
  const r = await req(`${API}/oauth/token/`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({ client_key: process.env.TIKTOK_CLIENT_KEY, client_secret: process.env.TIKTOK_CLIENT_SECRET, ...params }),
  });
  if (r.body.error && r.body.error !== 'ok') throw new Error(r.body.error_description || r.body.error);
  return {
    access_token: r.body.access_token, refresh_token: r.body.refresh_token,
    expires_at: Date.now() + (r.body.expires_in || 86400) * 1000, open_id: r.body.open_id,
  };
}

function chunks(size) {
  const MB = 1024 * 1024;
  if (size <= 64 * MB) return { chunk_size: size, total_chunk_count: 1 };
  const chunk_size = 10 * MB;
  return { chunk_size, total_chunk_count: Math.floor(size / chunk_size) };
}

module.exports = {
  id: 'tiktok', label: 'TikTok', color: '#000000', charLimit: 2200, requiresMedia: true,
  configured: () => !!(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET),
  authUrl({ state, redirectUri }) {
    return 'https://www.tiktok.com/v2/auth/authorize/?' + new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY, response_type: 'code', redirect_uri: redirectUri, state,
      scope: 'user.info.basic,video.publish',
    });
  },
  async handleCallback({ code, redirectUri }) {
    const t = await token({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
    const me = await req(`${API}/user/info/?fields=open_id,display_name,avatar_url`, { headers: { Authorization: `Bearer ${t.access_token}` } });
    const u = me.body.data?.user || {};
    return [{ network: 'tiktok', name: u.display_name || 'TikTok', external_id: t.open_id || u.open_id, avatar: u.avatar_url, ...t }];
  },
  refresh: account => token({ grant_type: 'refresh_token', refresh_token: account.refresh_token }),
  async publish({ token, text, media }) {
    if (!media.length) throw new Error('O TikTok exige um vídeo ou fotos.');
    const info = await req(`${API}/post/publish/creator_info/query/`, { method: 'POST', headers: json(token), body: '{}' });
    const opts = info.body.data?.privacy_level_options || ['SELF_ONLY'];
    const wanted = process.env.TIKTOK_PRIVACY || 'SELF_ONLY';
    const privacy_level = opts.includes(wanted) ? wanted : opts[opts.length - 1];
    const video = media.find(m => m.mime.startsWith('video/'));

    if (video) {
      const size = fs.statSync(video.path).size;
      const c = chunks(size);
      const init = await req(`${API}/post/publish/video/init/`, {
        method: 'POST', headers: json(token), body: JSON.stringify({
          post_info: { title: text.slice(0, 2200), privacy_level, disable_comment: false, disable_duet: false, disable_stitch: false },
          source_info: { source: 'FILE_UPLOAD', video_size: size, ...c },
        }),
      });
      const { upload_url, publish_id } = init.body.data;
      const buf = fs.readFileSync(video.path);
      for (let i = 0; i < c.total_chunk_count; i++) {
        const start = i * c.chunk_size;
        const end = i === c.total_chunk_count - 1 ? size - 1 : start + c.chunk_size - 1;
        const r = await fetch(upload_url, {
          method: 'PUT', body: buf.subarray(start, end + 1),
          headers: { 'Content-Type': video.mime, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) },
        });
        if (!r.ok) throw new Error('Falha no upload para o TikTok: ' + r.status);
      }
      return { external_id: publish_id, url: null };
    }
    // Fotos: o TikTok só aceita PULL_FROM_URL, de um domínio verificado na consola de developers
    const init = await req(`${API}/post/publish/content/init/`, {
      method: 'POST', headers: json(token), body: JSON.stringify({
        media_type: 'PHOTO', post_mode: 'DIRECT_POST',
        post_info: { title: text.slice(0, 90), description: text.slice(0, 4000), privacy_level },
        source_info: { source: 'PULL_FROM_URL', photo_images: media.map(m => m.url), photo_cover_index: 0 },
      }),
    });
    return { external_id: init.body.data.publish_id, url: null };
  },
  metrics: null,
};
