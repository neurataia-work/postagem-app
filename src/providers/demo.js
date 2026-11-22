// Rede de demonstração: permite testar toda a app sem credenciais reais
const { sleep } = require('./http');
const rnd = n => Math.floor(Math.random() * n);

module.exports = {
  id: 'demo', label: 'Demo', color: '#7C3AED', charLimit: 5000,
  configured: () => true, demo: true,
  async publish({ text }) {
    await sleep(300);
    if (/#falhar/i.test(text)) throw new Error('Falha simulada (o texto contém #falhar)');
    const id = 'demo_' + Date.now() + '_' + rnd(1000);
    return { external_id: id, url: null };
  },
  async metrics({ previous }) {
    const p = previous || {};
    return {
      impressions: (p.impressions || 0) + 50 + rnd(400),
      likes: (p.likes || 0) + rnd(40), comments: (p.comments || 0) + rnd(8),
      shares: (p.shares || 0) + rnd(6), clicks: (p.clicks || 0) + rnd(15),
    };
  },
};
