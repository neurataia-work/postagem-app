// LinkedIn (perfil pessoal) via Posts API
// Docs: https://learn.microsoft.com/linkedin/marketing/community-management/shares/posts-api
// Produtos a ativar na app: "Sign In with LinkedIn using OpenID Connect" + "Share on LinkedIn"
const fs = require('fs');
const { req, form } = require('./http');

const VERSION = () => process.env.LINKEDIN_VERSION || '202605';
const headers = token => ({
  Authorization: `Bearer ${token}`, 'LinkedIn-Version': VERSION(),
  'X-Restli-Protocol-Version': '2.0.0', 'Content-Type': 'application/json',
});
// O LinkedIn usa "little text format": estes caracteres têm de ser escapados (mantemos # para hashtags)
const escape = t => t.replace(/[\\|{}@\[\]()<>*_~]/g, c => '\\' + c);

module.exports = {
  id: 'linkedin', label: 'LinkedIn', color: '#0A66C2', charLimit: 3000,
  configured: () => !!(process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET),
  authUrl({ state, redirectUri }) {
    return 'https://www.linkedin.com/oauth/v2/authorization?' + new URLSearchParams({
      response_type: 'code', client_id: process.env.LINKEDIN_CLIENT_ID, redirect_uri: redirectUri,
      state, scope: 'openid profile w_member_social',
    });
  },
  async handleCallback({ code, redirectUri }) {
    const t = await req('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST', body: form({
        grant_type: 'authorization_code', code, redirect_uri: redirectUri,
        client_id: process.env.LINKEDIN_CLIENT_ID, client_secret: process.env.LINKEDIN_CLIENT_SECRET,
      }),
    });
    const me = await req('https://api.linkedin.com/v2/userinfo', { headers: { Authorization: `Bearer ${t.body.access_token}` } });
    return [{
      network: 'linkedin', name: me.body.name, external_id: me.body.sub, avatar: me.body.picture,
      access_token: t.body.access_token, refresh_token: t.body.refresh_token,
      expires_at: Date.now() + (t.body.expires_in || 5184000) * 1000,
    }];
  },
  async publish({ account, token, text, media }) {
    const author = `urn:li:person:${account.external_id}`;
    const images = [];
    for (const m of media) {
      if (!m.mime.startsWith('image/')) throw new Error('Este MVP publica no LinkedIn apenas texto e imagens.');
      const init = await req('https://api.linkedin.com/rest/images?action=initializeUpload', {
        method: 'POST', headers: headers(token), body: JSON.stringify({ initializeUploadRequest: { owner: author } }),
      });
      const up = await fetch(init.body.value.uploadUrl, {
        method: 'PUT', headers: { Authorization: `Bearer ${token}` }, body: fs.readFileSync(m.path),
      });
      if (!up.ok) throw new Error('Falha ao enviar imagem para o LinkedIn: ' + up.status);
      images.push(init.body.value.image);
    }
    const body = {
      author, commentary: escape(text), visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: 'PUBLISHED', isReshareDisabledByAuthor: false,
    };
    if (images.length === 1) body.content = { media: { id: images[0] } };
    if (images.length > 1) body.content = { multiImage: { images: images.map(id => ({ id })) } };
    const r = await req('https://api.linkedin.com/rest/posts', { method: 'POST', headers: headers(token), body: JSON.stringify(body) });
    const id = r.headers.get('x-restli-id');
    return { external_id: id, url: id ? `https://www.linkedin.com/feed/update/${id}` : null };
  },
  // Métricas de posts pessoais exigem a permissão restrita r_member_social; ficam como manuais
  metrics: null,
};
