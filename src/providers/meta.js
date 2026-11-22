// Facebook Pages + Instagram (contas profissionais) via Meta Graph API
// Docs: https://developers.facebook.com/docs/pages-api/posts
//       https://developers.facebook.com/docs/instagram-platform/content-publishing
const fs = require('fs');
const { req, form, sleep } = require('./http');

const V = process.env.META_GRAPH_VERSION || 'v21.0';
const G = `https://graph.facebook.com/${V}`;
const SCOPES = [
  'pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'read_insights',
  'instagram_basic', 'instagram_content_publish', 'instagram_manage_insights', 'business_management',
];

const configured = () => !!(process.env.META_APP_ID && process.env.META_APP_SECRET);

function authUrl({ state, redirectUri }) {
  const p = new URLSearchParams({
    client_id: process.env.META_APP_ID, redirect_uri: redirectUri, state,
    scope: SCOPES.join(','), response_type: 'code',
  });
  return `https://www.facebook.com/${V}/dialog/oauth?${p}`;
}

// Uma ligação Meta devolve todas as Páginas do utilizador e as contas Instagram associadas
async function handleCallback({ code, redirectUri }) {
  const short = await req(`${G}/oauth/access_token?` + form({
    client_id: process.env.META_APP_ID, client_secret: process.env.META_APP_SECRET,
    redirect_uri: redirectUri, code,
  }));
  // troca por token de longa duração (~60 dias); os tokens de página derivados não expiram
  const long = await req(`${G}/oauth/access_token?` + form({
    grant_type: 'fb_exchange_token', client_id: process.env.META_APP_ID,
    client_secret: process.env.META_APP_SECRET, fb_exchange_token: short.body.access_token,
  }));
  const userToken = long.body.access_token;
  const pages = await req(`${G}/me/accounts?` + form({
    fields: 'id,name,access_token,picture{url},instagram_business_account{id,username,profile_picture_url}',
    access_token: userToken, limit: 100,
  }));
  const out = [];
  for (const pg of pages.body.data || []) {
    out.push({
      network: 'facebook', name: pg.name, external_id: pg.id,
      avatar: pg.picture?.data?.url, access_token: pg.access_token,
    });
    const ig = pg.instagram_business_account;
    if (ig) out.push({
      network: 'instagram', name: '@' + (ig.username || ig.id), external_id: ig.id,
      avatar: ig.profile_picture_url, access_token: pg.access_token, meta: { page_id: pg.id },
    });
  }
  if (!out.length) throw new Error('Nenhuma Página do Facebook encontrada nesta conta. É preciso ser admin de uma Página.');
  return out;
}

const isVideo = m => m.mime?.startsWith('video/');

const facebook = {
  id: 'facebook', label: 'Facebook', color: '#1877F2', charLimit: 63206,
  configured, authUrl, handleCallback, connectVia: 'meta',
  async publish({ account, token, text, media }) {
    const pid = account.external_id;
    if (!media.length) {
      const r = await req(`${G}/${pid}/feed`, { method: 'POST', body: form({ message: text, access_token: token }) });
      return { external_id: r.body.id, url: `https://facebook.com/${r.body.id}` };
    }
    if (media.length === 1 && isVideo(media[0])) {
      const fd = new FormData();
      fd.append('description', text); fd.append('access_token', token);
      fd.append('source', new Blob([fs.readFileSync(media[0].path)], { type: media[0].mime }), media[0].file);
      const r = await req(`https://graph-video.facebook.com/${V}/${pid}/videos`, { method: 'POST', body: fd });
      return { external_id: r.body.id, url: `https://facebook.com/${r.body.id}` };
    }
    // uma ou várias fotos: carrega sem publicar e junta num único post
    const ids = [];
    for (const m of media.filter(m => !isVideo(m))) {
      const fd = new FormData();
      fd.append('published', 'false'); fd.append('access_token', token);
      fd.append('source', new Blob([fs.readFileSync(m.path)], { type: m.mime }), m.file);
      const r = await req(`${G}/${pid}/photos`, { method: 'POST', body: fd });
      ids.push(r.body.id);
    }
    const body = form({ message: text, access_token: token });
    ids.forEach((id, i) => body.append(`attached_media[${i}]`, JSON.stringify({ media_fbid: id })));
    const r = await req(`${G}/${pid}/feed`, { method: 'POST', body });
    return { external_id: r.body.id, url: `https://facebook.com/${r.body.id}` };
  },
  async metrics({ token, external_id }) {
    const r = await req(`${G}/${external_id}?` + form({
      fields: 'shares,comments.summary(true).limit(0),reactions.summary(true).limit(0)', access_token: token,
    }));
    let impressions = 0;
    try {
      const ins = await req(`${G}/${external_id}/insights?` + form({ metric: 'post_impressions', access_token: token }));
      impressions = ins.body.data?.[0]?.values?.[0]?.value || 0;
    } catch { /* insights nem sempre disponíveis */ }
    return {
      likes: r.body.reactions?.summary?.total_count || 0,
      comments: r.body.comments?.summary?.total_count || 0,
      shares: r.body.shares?.count || 0, impressions,
    };
  },
};

async function igContainer(igId, token, params) {
  const r = await req(`${G}/${igId}/media`, { method: 'POST', body: form({ ...params, access_token: token }) });
  return r.body.id;
}
async function igWait(id, token) {
  for (let i = 0; i < 30; i++) {
    const r = await req(`${G}/${id}?` + form({ fields: 'status_code,status', access_token: token }));
    if (r.body.status_code === 'FINISHED') return;
    if (r.body.status_code === 'ERROR') throw new Error('Instagram rejeitou o ficheiro: ' + (r.body.status || ''));
    await sleep(5000);
  }
  throw new Error('Instagram demorou demasiado a processar o vídeo');
}

const instagram = {
  id: 'instagram', label: 'Instagram', color: '#E1306C', charLimit: 2200, requiresMedia: true,
  configured, authUrl, handleCallback, connectVia: 'meta',
  // O Instagram vai buscar a imagem a um URL público: PUBLIC_URL tem de apontar para este servidor
  async publish({ account, token, text, media }) {
    if (!media.length) throw new Error('O Instagram exige pelo menos uma imagem ou vídeo.');
    const ig = account.external_id;
    let creation;
    if (media.length === 1) {
      const m = media[0];
      creation = await igContainer(ig, token, isVideo(m)
        ? { media_type: 'REELS', video_url: m.url, caption: text }
        : { image_url: m.url, caption: text });
      if (isVideo(m)) await igWait(creation, token);
    } else {
      const children = [];
      for (const m of media.slice(0, 10)) {
        const id = await igContainer(ig, token, isVideo(m)
          ? { media_type: 'VIDEO', video_url: m.url, is_carousel_item: true }
          : { image_url: m.url, is_carousel_item: true });
        if (isVideo(m)) await igWait(id, token);
        children.push(id);
      }
      creation = await igContainer(ig, token, { media_type: 'CAROUSEL', children: children.join(','), caption: text });
      await igWait(creation, token);
    }
    const r = await req(`${G}/${ig}/media_publish`, { method: 'POST', body: form({ creation_id: creation, access_token: token }) });
    let url;
    try { url = (await req(`${G}/${r.body.id}?` + form({ fields: 'permalink', access_token: token }))).body.permalink; } catch {}
    return { external_id: r.body.id, url };
  },
  async metrics({ token, external_id }) {
    const r = await req(`${G}/${external_id}?` + form({ fields: 'like_count,comments_count', access_token: token }));
    let impressions = 0, shares = 0;
    try {
      const ins = await req(`${G}/${external_id}/insights?` + form({ metric: 'reach,shares', access_token: token }));
      for (const d of ins.body.data || []) {
        if (d.name === 'reach') impressions = d.values?.[0]?.value || 0;
        if (d.name === 'shares') shares = d.values?.[0]?.value || 0;
      }
    } catch {}
    return { likes: r.body.like_count || 0, comments: r.body.comments_count || 0, shares, impressions };
  },
};

module.exports = { facebook, instagram };
