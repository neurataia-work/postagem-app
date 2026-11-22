// X (Twitter) via API v2 com OAuth 2.0 + PKCE
// Docs: https://docs.x.com/x-api/posts/create-post  |  https://docs.x.com/x-api/media/upload-media
const fs = require('fs');
const { req, form } = require('./http');

const basic = () => 'Basic ' + Buffer.from(`${process.env.X_CLIENT_ID}:${process.env.X_CLIENT_SECRET}`).toString('base64');

async function token(params) {
  const r = await req('https://api.x.com/2/oauth2/token', {
    method: 'POST', headers: { Authorization: basic(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({ ...params, client_id: process.env.X_CLIENT_ID }),
  });
  return {
    access_token: r.body.access_token, refresh_token: r.body.refresh_token,
    expires_at: Date.now() + (r.body.expires_in || 7200) * 1000,
  };
}

module.exports = {
  id: 'x', label: 'X', color: '#111111', charLimit: 280, usesPkce: true,
  configured: () => !!(process.env.X_CLIENT_ID && process.env.X_CLIENT_SECRET),
  authUrl({ state, challenge, redirectUri }) {
    return 'https://x.com/i/oauth2/authorize?' + new URLSearchParams({
      response_type: 'code', client_id: process.env.X_CLIENT_ID, redirect_uri: redirectUri, state,
      scope: 'tweet.read tweet.write users.read media.write offline.access',
      code_challenge: challenge, code_challenge_method: 'S256',
    });
  },
  async handleCallback({ code, verifier, redirectUri }) {
    const t = await token({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier });
    const me = await req('https://api.x.com/2/users/me?user.fields=profile_image_url', { headers: { Authorization: `Bearer ${t.access_token}` } });
    return [{ network: 'x', name: '@' + me.body.data.username, external_id: me.body.data.id, avatar: me.body.data.profile_image_url, ...t }];
  },
  refresh: account => token({ grant_type: 'refresh_token', refresh_token: account.refresh_token }),
  async publish({ token, text, media }) {
    const media_ids = [];
    for (const m of media.slice(0, 4)) {
      if (!m.mime.startsWith('image/')) throw new Error('Este MVP envia para o X apenas imagens (vídeo exige upload por partes).');
      const fd = new FormData();
      fd.append('media', new Blob([fs.readFileSync(m.path)], { type: m.mime }), m.file);
      fd.append('media_category', 'tweet_image');
      const r = await req('https://api.x.com/2/media/upload', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
      media_ids.push(r.body.data?.id || r.body.media_id_string);
    }
    const body = { text };
    if (media_ids.length) body.media = { media_ids };
    const r = await req('https://api.x.com/2/tweets', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return { external_id: r.body.data.id, url: `https://x.com/i/web/status/${r.body.data.id}` };
  },
  async metrics({ token, external_id }) {
    const r = await req(`https://api.x.com/2/tweets/${external_id}?tweet.fields=public_metrics`, { headers: { Authorization: `Bearer ${token}` } });
    const p = r.body.data?.public_metrics || {};
    return { likes: p.like_count || 0, comments: p.reply_count || 0, shares: (p.retweet_count || 0) + (p.quote_count || 0), impressions: p.impression_count || 0 };
  },
};
