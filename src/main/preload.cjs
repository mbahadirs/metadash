const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

/** Serialises the chart wrapper's SVG (data-chart-id) and rasterises it to PNG via canvas. */
async function pngChart({ chartId, scale = 2, background = '#10131A', name }) {
  const wrapper = document.querySelector(`[data-chart-id="${chartId}"]`);
  const svg = wrapper?.querySelector('svg');
  if (!svg) return { ok: false, error: { code: 'NO_CHART', message: document.documentElement.lang === 'tr' ? 'Grafik bulunamadı.' : 'Chart not found.', hint: null } };
  const clone = svg.cloneNode(true);
  const rect = svg.getBoundingClientRect();
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(rect.width));
  clone.setAttribute('height', String(rect.height));
  const styled = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([styled], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(rect.width * scale);
    canvas.height = Math.round(rect.height * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    return invoke('export:savePng', { dataUrl: canvas.toDataURL('image/png'), name: name ?? chartId });
  } finally {
    URL.revokeObjectURL(url);
  }
}

const api = {
  setup: {
    getState: () => invoke('setup:getState'),
    setStep: (step) => invoke('setup:setStep', step),
    saveApp: (p) => invoke('setup:saveApp', p),
    exchangeToken: (p) => invoke('setup:exchangeToken', p),
    getTokenHealth: () => invoke('setup:getTokenHealth'),
    discoverAccounts: () => invoke('setup:discoverAccounts'),
    saveTrackedAccounts: (igIds, meta) => invoke('setup:saveTrackedAccounts', { igIds, meta }),
    discoverAdAccounts: () => invoke('setup:discoverAdAccounts'),
    linkAdAccount: (p) => invoke('setup:linkAdAccount', p),
    complete: () => invoke('setup:complete'),
    loadDemo: (p) => invoke('setup:loadDemo', p),
    resetAll: () => invoke('setup:resetAll'),
    facebook: {
      discover: () => invoke('setup:facebook:discover'),
      saveTracked: (accountIds, meta) => invoke('setup:facebook:saveTracked', { accountIds, meta }),
    },
    threads: {
      getState: () => invoke('setup:threads:getState'),
      saveApp: (p) => invoke('setup:threads:saveApp', p),
      authUrl: (p) => invoke('setup:threads:authUrl', p),
      exchangeToken: (p) => invoke('setup:threads:exchangeToken', p),
      refresh: () => invoke('setup:threads:refresh'),
      disconnect: () => invoke('setup:threads:disconnect'),
      saveTracked: (tracked) => invoke('setup:threads:saveTracked', { tracked }),
    },
  },
  platforms: {
    list: () => invoke('platforms:list'),
  },
  accounts: {
    list: (p) => invoke('accounts:list', p),
    get: (igId) => invoke('accounts:get', igId),
    update: (igId, patch) => invoke('accounts:update', igId, patch),
    setTags: (igId, tagIds) => invoke('accounts:setTags', igId, tagIds),
    clientLogos: () => invoke('accounts:clientLogos'),
    getClientLogo: (igId) => invoke('accounts:getClientLogo', igId),
    setClientLogo: (igId, dataUrl) => invoke('accounts:setClientLogo', igId, dataUrl),
  },
  tags: {
    list: () => invoke('tags:list'),
    create: (p) => invoke('tags:create', p),
    delete: (id) => invoke('tags:delete', id),
  },
  notes: {
    list: (p) => invoke('notes:list', p),
    add: (p) => invoke('notes:add', p),
    delete: (id) => invoke('notes:delete', id),
  },
  sync: {
    run: (p) => invoke('sync:run', p),
    cancel: () => invoke('sync:cancel'),
    status: () => invoke('sync:status'),
    history: (p) => invoke('sync:history', p),
    errors: (p) => invoke('sync:errors', p),
    suggest: () => invoke('sync:suggest'),
    disabledMetrics: () => invoke('sync:disabledMetrics'),
    enableMetric: (m) => invoke('sync:enableMetric', m),
  },
  analytics: {
    portfolio: (p) => invoke('analytics:portfolio', p),
    account: (p) => invoke('analytics:account', p),
    compare: (p) => invoke('analytics:compare', p),
    content: (p) => invoke('analytics:content', p),
    media: (id) => invoke('analytics:media', id),
    contentAnalysis: (p) => invoke('analytics:contentAnalysis', p),
    comparePosts: (p) => invoke('analytics:comparePosts', p),
    bestTime: (p) => invoke('analytics:bestTime', p),
    lifecycle: (p) => invoke('analytics:lifecycle', p),
    demographics: (p) => invoke('analytics:demographics', p),
    stories: (p) => invoke('analytics:stories', p),
    health: (p) => invoke('analytics:health', p),
    anomalies: (p) => invoke('analytics:anomalies', p),
    weeklyDigest: (p) => invoke('analytics:weeklyDigest', p),
    leaderboard: (p) => invoke('analytics:leaderboard', p),
    definitions: () => invoke('analytics:definitions'),
  },
  ads: {
    accounts: () => invoke('ads:accounts'),
    link: (p) => invoke('ads:link', p),
    setTracked: (p) => invoke('ads:setTracked', p),
    insights: (p) => invoke('ads:insights', p),
    blended: (p) => invoke('ads:blended', p),
    setBudget: (p) => invoke('ads:setBudget', p),
    budget: (p) => invoke('ads:budget', p ?? {}),
    boostCandidates: (p) => invoke('ads:boostCandidates', p),
    budgetTree: (p) => invoke('ads:budgetTree', p),
    setObjectBudget: (p) => invoke('ads:setObjectBudget', p),
  },
  competitors: {
    list: (igId) => invoke('competitors:list', igId),
    add: (p) => invoke('competitors:add', p),
    remove: (id) => invoke('competitors:remove', id),
    compare: (p) => invoke('competitors:compare', p),
  },
  export: {
    html: (p) => invoke('export:html', p),
    pdf: (p) => invoke('export:pdf', p),
    csv: (p) => invoke('export:csv', p),
    xlsx: (p) => invoke('export:xlsx', p),
    tablePdf: (p) => invoke('export:tablePdf', p),
    xlsxReport: (p) => invoke('export:xlsxReport', p),
    csvQueries: () => invoke('export:csvQueries'),
    preview: (p) => invoke('export:preview', p),
    sections: () => invoke('export:sections'),
    history: () => invoke('export:history'),
    clearHistory: () => invoke('export:clearHistory'),
    pngChart,
    pickLogo: () => invoke('export:pickLogo'),
    branding: () => invoke('export:branding'),
    setBranding: (patch) => invoke('export:setBranding', patch),
  },
  system: {
    openExternal: (url) => invoke('system:openExternal', url),
    revealFile: (p) => invoke('system:revealFile', p),
    openGuide: () => invoke('system:openGuide'),
    info: () => invoke('system:info'),
    online: () => invoke('system:online'),
  },
  db: {
    backup: () => invoke('db:backup'),
    restore: (p) => invoke('db:restore', p ?? null),
  },
  settings: {
    get: (key) => invoke('settings:get', key),
    set: (key, value) => invoke('settings:set', key, value),
    all: () => invoke('settings:all'),
  },
  sql: { run: (query, limit) => invoke('sql:run', { query, limit }) },
  update: {
    status: () => invoke('update:status'),
    check: () => invoke('update:check'),
    download: () => invoke('update:download'),
    install: () => invoke('update:install'),
    openRelease: () => invoke('update:openRelease'),
  },
  ai: {
    status: () => invoke('ai:status'),
    setConfig: (patch) => invoke('ai:setConfig', patch),
    setKey: (provider, key) => invoke('ai:setKey', { provider, key }),
    test: () => invoke('ai:test'),
    reportCommentary: (p) => invoke('ai:reportCommentary', p),
    explainAnomaly: (p) => invoke('ai:explainAnomaly', p),
    ask: (p) => invoke('ai:ask', p),
    askCancel: (requestId) => invoke('ai:askCancel', { requestId }),
  },
  transfer: {
    export: (p) => invoke('transfer:export', p ?? {}),
    pick: () => invoke('transfer:pick'),
    import: (p) => invoke('transfer:import', p),
  },
  on: (channel, cb) => {
    if (!['sync:progress', 'sync:done', 'token:warning', 'update:status', 'app:navigate'].includes(channel)) return () => {};
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
};

contextBridge.exposeInMainWorld('api', api);
