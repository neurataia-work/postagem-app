// ===== Postagem — interface (JavaScript simples, sem build) =====
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const view = $('#view');
const state = { networks: [], accounts: [], calMonth: null, postsTab: 'all' };
const STATUS = { draft: 'Rascunho', scheduled: 'Agendado', publishing: 'A publicar', published: 'Publicado', partial: 'Parcial', failed: 'Falhou', pending: 'Pendente' };
const DOW = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const fmt = n => new Intl.NumberFormat('pt-PT', { notation: n > 99999 ? 'compact' : 'standard' }).format(n || 0);
const dt = ms => ms ? new Date(ms).toLocaleString('pt-PT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

async function api(url, opts = {}) {
  const res = await fetch(url, { headers: opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}, ...opts,
    body: opts.body && !(opts.body instanceof FormData) ? JSON.stringify(opts.body) : opts.body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}
function toast(msg, bad) {
  const d = document.createElement('div'); d.textContent = msg; if (bad) d.className = 'bad';
  $('#toast').append(d); setTimeout(() => d.remove(), bad ? 6000 : 3000);
}
const net = id => state.networks.find(n => n.id === id) || { label: id, color: '#888', charLimit: 99999 };
const acc = id => state.accounts.find(a => a.id === id);
function avatar(a) {
  const n = net(a.network);
  return `<span class="av" style="--c:${n.color}" title="${esc(n.label)}">${a.avatar ? `<img src="${esc(a.avatar)}" alt="">` : esc(n.label[0])}</span>`;
}
const badge = s => `<span class="badge b-${s}">${STATUS[s] || s}</span>`;
const mediaUrl = m => '/uploads/' + encodeURIComponent(m.file);
const mediaTag = m => m.mime.startsWith('video/') ? `<video src="${mediaUrl(m)}" muted></video>` : `<img src="${mediaUrl(m)}" alt="">`;
const toLocalInput = ms => { const d = new Date(ms); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

async function loadBase() {
  [state.networks, state.accounts] = await Promise.all([api('/api/networks'), api('/api/accounts')]);
}

// ---------- Router ----------
const routes = { '': dashboard, criar: composer, calendario: calendar, posts: postsList, analises: analytics, contas: accounts };
async function router() {
  const [path, qs] = location.hash.replace(/^#\/?/, '').split('?');
  const [name, arg] = path.split('/');
  document.querySelectorAll('nav a').forEach(a => a.classList.toggle('on', a.dataset.r === name));
  try { await loadBase(); await (routes[name] || dashboard)(arg, new URLSearchParams(qs)); }
  catch (e) { view.innerHTML = `<div class="card err">${esc(e.message)}</div>`; }
}
addEventListener('hashchange', router);
setInterval(() => { $('#clock').textContent = new Date().toLocaleString('pt-PT', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }, 1000);

// ---------- Painel ----------
async function dashboard() {
  const [a, upcoming] = await Promise.all([api('/api/analytics?days=30'), api('/api/posts?status=scheduled')]);
  const q = Object.fromEntries(a.queue.map(r => [r.status, r.n]));
  const next = upcoming.sort((x, y) => x.scheduled_at - y.scheduled_at).slice(0, 6);
  view.innerHTML = `
    <div class="row spread"><div><h1>Painel</h1><p class="sub">Resumo dos últimos 30 dias</p></div>
      <a class="btn primary" href="#/criar">+ Criar post</a></div>
    ${!state.accounts.length ? `<div class="card" style="margin-bottom:16px"><b>Comece por ligar uma conta.</b>
      <span class="muted">Sem credenciais ainda? Adicione uma conta Demo para experimentar.</span> <a href="#/contas">Ir para Contas →</a></div>` : ''}
    <div class="grid g4">
      ${kpi('Agendados', q.scheduled)}${kpi('Publicados (30 d)', a.totals.posts)}${kpi('Impressões', a.totals.impressions)}
      ${kpi('Interações', a.totals.likes + a.totals.comments + a.totals.shares)}
    </div>
    <div class="grid g2" style="margin-top:16px">
      <div class="card"><h3>Próximas publicações</h3>
        ${next.length ? next.map(postRow).join('') : '<div class="empty">Nada agendado.</div>'}</div>
      <div class="card"><h3>Melhores horas para publicar</h3>${bestTimes(a.heat)}</div>
    </div>
    ${q.failed || q.partial ? `<div class="card" style="margin-top:16px"><b class="danger">${(q.failed || 0) + (q.partial || 0)} publicação(ões) com erro.</b> <a href="#/posts?tab=failed">Ver e tentar novamente →</a></div>` : ''}`;
  bindPostRows();
}
const kpi = (l, v) => `<div class="card kpi"><div class="l">${l}</div><div class="v">${fmt(v)}</div></div>`;
function bestTimes(heat) {
  const top = heat.filter(h => h.n > 0).sort((a, b) => b.eng - a.eng).slice(0, 3);
  if (!top.length) return '<div class="muted">Ainda não há dados suficientes. Depois de algumas publicações, aqui aparecem os dias e horas com mais interações.</div>';
  return top.map((h, i) => `<div class="net"><b>${i + 1}.</b><div class="grow">${['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'][h.dow]}, ${String(h.hour).padStart(2, '0')}:00</div>
    <span class="muted">${fmt(Math.round(h.eng))} interações/post</span></div>`).join('');
}

// ---------- Compositor ----------
async function composer(editId, params) {
  let post = { content: '', media: [], targets: [], scheduled_at: null };
  if (editId) post = (await api('/api/posts')).find(p => p.id === Number(editId)) || post;
  const sel = new Set(post.targets.map(t => t.account_id));
  if (!editId && state.accounts.length === 1) sel.add(state.accounts[0].id);
  const custom = Object.fromEntries(post.targets.filter(t => t.custom_content != null).map(t => [t.account_id, t.custom_content]));
  let media = post.media.slice();
  let perNet = Object.keys(custom).length > 0;
  const preset = params.get('data');
  const defWhen = post.scheduled_at || (preset ? new Date(preset + 'T10:00').getTime() : Date.now() + 3600e3);

  view.innerHTML = `
    <h1>${editId ? 'Editar post' : 'Criar post'}</h1><p class="sub">Escreva uma vez, publique em várias redes.</p>
    <div class="grid g2">
      <div class="card">
        <label class="f" style="margin-top:0">Publicar em</label>
        <div class="chips" id="accs">${state.accounts.length ? state.accounts.map(a => `
          <span class="chip ${sel.has(a.id) ? 'on' : ''}" data-id="${a.id}" style="--c:${net(a.network).color}">${avatar(a)}${esc(a.name)}</span>`).join('')
          : '<span class="muted">Nenhuma conta ligada. <a href="#/contas">Ligar contas</a></span>'}</div>
        <label class="f">Texto</label>
        <textarea id="txt" placeholder="O que quer partilhar?">${esc(post.content)}</textarea>
        <div class="row spread" style="margin-top:6px"><div id="counters" class="row"></div>
          <label class="row muted" style="gap:6px;cursor:pointer"><input type="checkbox" id="pernet" style="width:auto" ${perNet ? 'checked' : ''}> Texto diferente por conta</label></div>
        <div id="customs"></div>
        <label class="f">Imagens ou vídeo</label>
        <div class="drop" id="drop">Arraste ficheiros para aqui ou <u>clique para escolher</u><input type="file" id="file" multiple accept="image/*,video/*" hidden></div>
        <div class="media" id="media"></div>
        <label class="f">Data e hora</label>
        <input type="datetime-local" id="when" value="${toLocalInput(defWhen)}" style="max-width:260px">
        <div class="row" style="margin-top:22px">
          <button class="primary" data-act="schedule">Agendar</button>
          <button data-act="now">Publicar agora</button>
          <button data-act="draft">Guardar rascunho</button>
        </div>
      </div>
      <div><div class="card"><h3>Pré-visualização</h3><div id="prev"></div></div></div>
    </div>`;

  const txt = $('#txt');
  const selected = () => [...sel].map(acc).filter(Boolean);
  function render() {
    const t = txt.value;
    $('#counters').innerHTML = [...new Set(selected().map(a => a.network))].map(n => {
      const N = net(n); const len = t.length;
      return `<span class="counter ${len > N.charLimit ? 'over' : ''}" style="color:${len > N.charLimit ? '' : N.color}">${N.label} ${len}/${N.charLimit}</span>`;
    }).join('') || '<span class="muted counter">Escolha as contas</span>';
    $('#customs').innerHTML = perNet ? selected().map(a => `<label class="f">${avatar(a)} ${esc(a.name)}</label>
      <textarea class="ctm" data-id="${a.id}" style="min-height:90px" placeholder="(usa o texto principal)">${esc(custom[a.id] ?? '')}</textarea>`).join('') : '';
    document.querySelectorAll('.ctm').forEach(el => el.oninput = () => { custom[el.dataset.id] = el.value; renderPreview(); });
    $('#media').innerHTML = media.map((m, i) => `<div class="thumb">${mediaTag(m)}<button data-rm="${i}">✕</button></div>`).join('');
    document.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { media.splice(+b.dataset.rm, 1); render(); });
    renderPreview();
  }
  function renderPreview() {
    const list = selected();
    $('#prev').innerHTML = (list.length ? list : [{ network: 'demo', name: 'A sua conta' }]).map(a => {
      const t = (perNet && custom[a.id]) || txt.value;
      const N = net(a.network);
      const warn = N.requiresMedia && !media.length ? `<div class="err">${N.label} exige imagem ou vídeo.</div>` : '';
      return `<div class="preview" style="margin-bottom:12px"><div class="who">${avatar(a)}<div>${esc(a.name)}<div class="muted" style="font-weight:400;font-size:12px">${N.label}</div></div></div>
        <div class="txt">${esc(t) || '<span class="muted">…</span>'}</div>${media[0] ? mediaTag(media[0]).replace('muted', 'muted controls') : ''}
        ${media.length > 1 ? `<div class="muted" style="font-size:12px">+${media.length - 1} ficheiro(s)</div>` : ''}${warn}</div>`;
    }).join('');
  }
  async function uploadFiles(files) {
    if (!files.length) return;
    const fd = new FormData(); [...files].forEach(f => fd.append('files', f));
    toast('A carregar…');
    try { media.push(...await api('/api/upload', { method: 'POST', body: fd })); render(); }
    catch (e) { toast(e.message, true); }
  }
  txt.oninput = render;
  $('#pernet').onchange = e => { perNet = e.target.checked; render(); };
  document.querySelectorAll('#accs .chip').forEach(c => c.onclick = () => {
    const id = Number(c.dataset.id); sel.has(id) ? sel.delete(id) : sel.add(id); c.classList.toggle('on'); render();
  });
  const drop = $('#drop');
  drop.onclick = () => $('#file').click();
  $('#file').onchange = e => uploadFiles(e.target.files);
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('hover'); };
  drop.ondragleave = () => drop.classList.remove('hover');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('hover'); uploadFiles(e.dataTransfer.files); };
  document.querySelectorAll('[data-act]').forEach(b => b.onclick = async () => {
    const action = b.dataset.act;
    const c = {};
    if (perNet) for (const a of selected()) if (custom[a.id]?.trim()) c[a.id] = custom[a.id];
    const body = { content: txt.value, media, account_ids: [...sel], custom: c, action,
      scheduled_at: $('#when').value ? new Date($('#when').value).getTime() : null };
    document.querySelectorAll('[data-act]').forEach(x => x.disabled = true);
    try {
      const r = await api(editId ? `/api/posts/${editId}` : '/api/posts', { method: editId ? 'PUT' : 'POST', body });
      const msg = { draft: 'Rascunho guardado', schedule: 'Agendado para ' + dt(r.scheduled_at), now: r.status === 'published' ? 'Publicado!' : 'Publicação terminou com estado: ' + STATUS[r.status] }[action];
      toast(msg, r.status === 'failed');
      location.hash = action === 'schedule' ? '#/calendario' : '#/posts';
    } catch (e) { toast(e.message, true); document.querySelectorAll('[data-act]').forEach(x => x.disabled = false); }
  });
  render();
}

// ---------- Calendário ----------
async function calendar() {
  const now = new Date();
  const m = state.calMonth || new Date(now.getFullYear(), now.getMonth(), 1);
  state.calMonth = m;
  const start = new Date(m); start.setDate(1 - ((m.getDay() + 6) % 7)); // semana começa à segunda
  const end = new Date(start); end.setDate(start.getDate() + 42);
  const posts = (await api(`/api/posts?from=${start.getTime()}&to=${end.getTime()}`)).filter(p => p.scheduled_at);
  const byDay = {};
  posts.forEach(p => { const k = new Date(p.scheduled_at).toDateString(); (byDay[k] ||= []).push(p); });
  const days = [...Array(42)].map((_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  const key = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  view.innerHTML = `
    <div class="row spread"><div><h1>Calendário</h1><p class="sub">Clique num dia para criar um post. Arraste um post agendado para o mudar de dia.</p></div>
      <div class="row"><button id="prev">‹</button><b style="min-width:150px;text-align:center">${(s => s[0].toUpperCase() + s.slice(1))(m.toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' }))}</b><button id="next">›</button><button id="today">Hoje</button></div></div>
    <div class="cal">
      ${['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map(d => `<div class="h">${d}</div>`).join('')}
      ${days.map(d => `<div class="d ${d.getMonth() !== m.getMonth() ? 'out' : ''} ${d.toDateString() === now.toDateString() ? 'today' : ''}" data-day="${key(d)}">
        <span class="n">${d.getDate()}</span>
        ${(byDay[d.toDateString()] || []).sort((a, b) => a.scheduled_at - b.scheduled_at).map(p => {
          const first = acc(p.targets[0]?.account_id);
          return `<div class="ev st-${p.status}" draggable="${['scheduled', 'draft'].includes(p.status)}" data-id="${p.id}" style="--c:${first ? net(first.network).color : ''}"
            title="${esc(STATUS[p.status])} · ${esc(p.content)}">${new Date(p.scheduled_at).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })} ${esc(p.content || '(media)')}</div>`;
        }).join('')}</div>`).join('')}
    </div>`;
  $('#prev').onclick = () => { state.calMonth = new Date(m.getFullYear(), m.getMonth() - 1, 1); calendar(); };
  $('#next').onclick = () => { state.calMonth = new Date(m.getFullYear(), m.getMonth() + 1, 1); calendar(); };
  $('#today').onclick = () => { state.calMonth = null; calendar(); };
  document.querySelectorAll('.cal .d').forEach(d => {
    d.onclick = e => { if (!e.target.closest('.ev')) location.hash = '#/criar?data=' + d.dataset.day; };
    d.ondragover = e => { e.preventDefault(); d.classList.add('over'); };
    d.ondragleave = () => d.classList.remove('over');
    d.ondrop = async e => {
      e.preventDefault(); d.classList.remove('over');
      const id = Number(e.dataTransfer.getData('text/plain'));
      const p = posts.find(x => x.id === id); if (!p) return;
      const old = new Date(p.scheduled_at);
      const nd = new Date(d.dataset.day + 'T00:00'); nd.setHours(old.getHours(), old.getMinutes());
      try { await api(`/api/posts/${id}/reschedule`, { method: 'PATCH', body: { scheduled_at: nd.getTime() } }); toast('Movido para ' + dt(nd.getTime())); calendar(); }
      catch (err) { toast(err.message, true); }
    };
  });
  document.querySelectorAll('.ev').forEach(ev => {
    ev.ondragstart = e => e.dataTransfer.setData('text/plain', ev.dataset.id);
    ev.onclick = () => {
      const p = posts.find(x => x.id === Number(ev.dataset.id));
      location.hash = ['published', 'publishing'].includes(p.status) ? '#/posts' : '#/criar/' + p.id;
    };
  });
}

// ---------- Lista de publicações ----------
function postRow(p) {
  return `<div class="post" data-id="${p.id}">
    <div class="pm">${p.media[0] ? mediaTag(p.media[0]) : ''}</div>
    <div class="body">
      <div class="row" style="gap:8px">${badge(p.status)}<span class="muted">${p.scheduled_at ? dt(p.scheduled_at) : 'Sem data'}</span></div>
      <div class="txt" style="margin-top:4px">${esc(p.content) || '<span class="muted">(só media)</span>'}</div>
      <div>${p.targets.map(t => {
        const a = acc(t.account_id) || { network: t.network, name: t.account_name || 'Conta removida' };
        const stats = t.status === 'published' && (t.impressions || t.likes) ? ` · ${fmt(t.impressions)} imp · ${fmt(t.likes)} ♥` : '';
        return `<span class="tg">${avatar(a)}${esc(a.name)} ${badge(t.status)}${t.url ? ` <a href="${esc(t.url)}" target="_blank" rel="noopener">ver</a>` : ''}<span class="muted">${stats}</span></span>
          ${t.error ? `<div class="err">${esc(net(a.network).label)}: ${esc(t.error)}</div>` : ''}`;
      }).join('')}</div>
    </div>
    <div class="acts">
      ${['failed', 'partial'].includes(p.status) ? '<button class="small" data-retry>Tentar de novo</button>' : ''}
      ${!['published', 'publishing'].includes(p.status) ? '<button class="small" data-edit>Editar</button>' : ''}
      <button class="small danger" data-del>Apagar</button>
    </div></div>`;
}
function bindPostRows(reload = router) {
  document.querySelectorAll('.post').forEach(el => {
    const id = el.dataset.id;
    el.querySelector('[data-edit]')?.addEventListener('click', () => location.hash = '#/criar/' + id);
    el.querySelector('[data-del]')?.addEventListener('click', async () => {
      if (!confirm('Apagar este post da app? (Não apaga o que já foi publicado nas redes.)')) return;
      await api('/api/posts/' + id, { method: 'DELETE' }); toast('Apagado'); reload();
    });
    el.querySelector('[data-retry]')?.addEventListener('click', async e => {
      e.target.disabled = true; e.target.textContent = 'A publicar…';
      try { const r = await api(`/api/posts/${id}/retry`, { method: 'POST' }); toast('Estado: ' + STATUS[r.status], r.status !== 'published'); }
      catch (err) { toast(err.message, true); }
      reload();
    });
  });
}
async function postsList(_, params) {
  if (params.get('tab')) state.postsTab = params.get('tab');
  const all = await api('/api/posts');
  const tabs = { all: 'Todas', scheduled: 'Agendadas', draft: 'Rascunhos', published: 'Publicadas', failed: 'Com erro' };
  const filt = state.postsTab === 'all' ? all : all.filter(p => state.postsTab === 'failed' ? ['failed', 'partial'].includes(p.status) : p.status === state.postsTab);
  view.innerHTML = `<div class="row spread"><div><h1>Publicações</h1><p class="sub">${all.length} no total</p></div><a class="btn primary" href="#/criar">+ Criar post</a></div>
    <div class="tabs">${Object.entries(tabs).map(([k, v]) => `<button data-tab="${k}" class="${state.postsTab === k ? 'on' : ''}">${v}</button>`).join('')}</div>
    <div class="card">${filt.length ? filt.map(postRow).join('') : '<div class="empty">Nada aqui ainda.</div>'}</div>`;
  document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { state.postsTab = b.dataset.tab; postsList(null, new URLSearchParams()); });
  bindPostRows(() => postsList(null, new URLSearchParams()));
}

// ---------- Contas ----------
async function accounts(_, params) {
  if (params.get('erro')) toast('Erro ao ligar: ' + params.get('erro'), true);
  if (params.get('ok')) toast(`${params.get('ok')} conta(s) ligada(s)`);
  if (params.get('erro') || params.get('ok')) history.replaceState(null, '', '#/contas');
  const nets = state.networks.filter(n => !n.demo);
  view.innerHTML = `<h1>Contas</h1><p class="sub">Ligue as suas redes sociais. Facebook e Instagram ligam-se juntos através da Meta.</p>
    <div class="grid g2">
      <div class="card"><h3>Redes disponíveis</h3>
        ${nets.map(n => `<div class="net"><span class="av" style="--c:${n.color}">${n.label[0]}</span>
          <div class="grow"><b>${n.label}</b><div class="muted" style="font-size:12px">${n.configured ? 'Pronto a ligar' : 'Falta configurar as credenciais da API no ficheiro .env'}</div></div>
          ${n.configured ? `<a class="btn primary small" href="/auth/${n.id}/start">Ligar</a>` : '<button class="small" disabled>Ligar</button>'}</div>`).join('')}
        <div class="net"><span class="av" style="--c:#7C3AED">D</span><div class="grow"><b>Demo</b><div class="muted" style="font-size:12px">Simula publicações e métricas, para testar sem credenciais</div></div>
          <button class="small" id="demo">Adicionar</button></div>
      </div>
      <div class="card"><h3>Contas ligadas (${state.accounts.length})</h3>
        ${state.accounts.length ? state.accounts.map(a => `<div class="net">${avatar(a)}<div class="grow"><b>${esc(a.name)}</b>
          <div class="muted" style="font-size:12px">${net(a.network).label}${a.expires_at ? ' · token válido até ' + dt(a.expires_at) : ''}</div></div>
          <button class="small danger" data-rm="${a.id}">Remover</button></div>`).join('') : '<div class="empty">Nenhuma conta ligada.</div>'}
      </div>
    </div>`;
  $('#demo').onclick = async () => {
    const name = prompt('Nome da conta demo:', 'Minha Marca (demo)'); if (!name) return;
    await api('/api/accounts/demo', { method: 'POST', body: { name } }); toast('Conta demo adicionada'); router();
  };
  document.querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => {
    if (!confirm('Remover esta conta? Os posts agendados para ela deixam de ser publicados.')) return;
    await api('/api/accounts/' + b.dataset.rm, { method: 'DELETE' }); router();
  });
}

// ---------- Análises ----------
async function analytics(_, params) {
  const days = Number(params.get('dias')) || 30;
  const a = await api('/api/analytics?days=' + days);
  const series = []; const map = Object.fromEntries(a.byDay.map(d => [d.day, d]));
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400e3); const k = d.toLocaleDateString('sv-SE');
    series.push({ k, v: map[k] ? map[k].likes + map[k].comments + map[k].shares : 0, imp: map[k]?.impressions || 0 });
  }
  const max = Math.max(1, ...series.map(s => s.v));
  const heatMax = Math.max(1, ...a.heat.map(h => h.eng));
  const hm = {}; a.heat.forEach(h => hm[h.dow + '-' + h.hour] = h);
  const eng = a.totals.likes + a.totals.comments + a.totals.shares;
  view.innerHTML = `
    <div class="row spread"><div><h1>Análises</h1><p class="sub">Desempenho das publicações feitas pela app</p></div>
      <div class="row"><select id="days" style="width:auto">${[7, 30, 90, 365].map(d => `<option value="${d}" ${d === days ? 'selected' : ''}>Últimos ${d} dias</option>`).join('')}</select>
      <button id="refresh">Atualizar métricas</button></div></div>
    <div class="grid g4">${kpi('Publicações', a.totals.posts)}${kpi('Impressões', a.totals.impressions)}${kpi('Interações', eng)}
      ${kpi('Taxa de interação', 0).replace('>0<', `>${a.totals.impressions ? (eng / a.totals.impressions * 100).toFixed(1) + '%' : '—'}<`)}</div>
    <div class="card" style="margin-top:16px"><h3>Interações por dia</h3>
      <div class="bars">${series.map(s => `<div style="height:${(s.v / max) * 100}%" title="${s.k}: ${s.v} interações, ${s.imp} impressões"></div>`).join('')}</div>
      <div class="row spread muted" style="font-size:11px;margin-top:4px"><span>${series[0].k}</span><span>${series.at(-1).k}</span></div></div>
    <div class="grid g2" style="margin-top:16px">
      <div class="card"><h3>Por rede</h3>${a.byNetwork.length ? `<table><tr><th>Rede</th><th>Posts</th><th>Impressões</th><th>Gostos</th><th>Coment.</th><th>Partilhas</th></tr>
        ${a.byNetwork.map(r => `<tr><td><span class="badge" style="background:${net(r.network).color};color:#fff">${net(r.network).label}</span></td><td>${r.posts}</td><td>${fmt(r.impressions)}</td><td>${fmt(r.likes)}</td><td>${fmt(r.comments)}</td><td>${fmt(r.shares)}</td></tr>`).join('')}</table>` : '<div class="empty">Sem dados</div>'}</div>
      <div class="card"><h3>Melhores dias e horas</h3>
        <div class="heat"><span></span>${[...Array(24)].map((_, h) => `<span style="text-align:center">${h % 3 ? '' : h}</span>`).join('')}
        ${[1, 2, 3, 4, 5, 6, 0].map(d => `<span>${DOW[d]}</span>` + [...Array(24)].map((_, h) => {
          const c = hm[d + '-' + h]; const o = c ? 0.15 + 0.85 * (c.eng / heatMax) : 0;
          return `<div class="c" style="${c ? `background:color-mix(in srgb,var(--brand) ${Math.round(o * 100)}%,var(--soft))` : ''}" title="${DOW[d]} ${h}h${c ? `: ${c.eng.toFixed(1)} interações médias (${c.n} posts)` : ''}"></div>`;
        }).join('')).join('')}</div></div>
    </div>
    <div class="card" style="margin-top:16px"><h3>Top publicações</h3>${a.top.length ? `<table><tr><th>Post</th><th>Conta</th><th>Data</th><th>Impressões</th><th>Interações</th></tr>
      ${a.top.map(t => `<tr><td style="max-width:360px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${t.url ? `<a href="${esc(t.url)}" target="_blank" rel="noopener">${esc(t.content || '(media)')}</a>` : esc(t.content || '(media)')}</td>
        <td>${esc(t.account_name)}</td><td>${dt(t.published_at)}</td><td>${fmt(t.impressions)}</td><td>${fmt(t.engagement)}</td></tr>`).join('')}</table>` : '<div class="empty">Sem dados</div>'}
      <p class="muted" style="font-size:12px;margin-bottom:0">LinkedIn e TikTok não dão métricas de posts com as permissões básicas; aparecem com 0 até a app ter acesso aprovado.</p></div>`;
  $('#days').onchange = e => location.hash = '#/analises?dias=' + e.target.value;
  $('#refresh').onclick = async e => { e.target.disabled = true; e.target.textContent = 'A atualizar…'; await api('/api/metrics/refresh', { method: 'POST' }); toast('Métricas atualizadas'); router(); };
}

router();
