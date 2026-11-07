'use strict';
/* Loterias CAIXA — Análise & Estratégias. Seções: configuração, banco local (IndexedDB), sincronização,
   estatísticas, gerador, análises, importação/exportação, eventos (bind) e inicialização (init). */

const DB_NAME = 'loterias-caixa-db',
  DB_VERSION = 1,
  STORE = 'draws',
  SAVED_KEY = 'lc_saved_v2',
  META_KEY = 'lc_meta_v2';
const MONTHS = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];
const CFG = {
  megasena: {
    label: 'Mega-Sena',
    slug: 'megasena',
    max: 60,
    min: 6,
    base: 6,
    maxPick: 20,
    mainCount: 6,
    kind: 'numbers',
  },
  lotofacil: {
    label: 'Lotofácil',
    slug: 'lotofacil',
    max: 25,
    min: 15,
    base: 15,
    maxPick: 20,
    mainCount: 15,
    kind: 'numbers',
  },
  quina: { label: 'Quina', slug: 'quina', max: 80, min: 5, base: 5, maxPick: 15, mainCount: 5, kind: 'numbers' },
  lotomania: {
    label: 'Lotomania',
    slug: 'lotomania',
    max: 99,
    min: 50,
    base: 50,
    maxPick: 50,
    mainCount: 20,
    kind: 'numbers',
    zero: true,
  },
  duplasena: {
    label: 'Dupla Sena',
    slug: 'duplasena',
    max: 50,
    min: 6,
    base: 6,
    maxPick: 15,
    mainCount: 6,
    kind: 'double',
  },
  diadesorte: {
    label: 'Dia de Sorte',
    slug: 'diadesorte',
    max: 31,
    min: 7,
    base: 7,
    maxPick: 15,
    mainCount: 7,
    kind: 'month',
  },
  timemania: {
    label: 'Timemania',
    slug: 'timemania',
    max: 80,
    min: 10,
    base: 10,
    maxPick: 10,
    mainCount: 7,
    kind: 'team',
  },
  supersete: {
    label: 'Super Sete',
    slug: 'supersete',
    max: 9,
    min: 7,
    base: 7,
    maxPick: 7,
    mainCount: 7,
    kind: 'columns',
    digit: true,
  },
  maismilionaria: {
    label: '+Milionária',
    slug: 'maismilionaria',
    max: 50,
    min: 6,
    base: 6,
    maxPick: 12,
    mainCount: 6,
    kind: 'trevos',
  },
};
const $ = (id) => document.getElementById(id),
  pad = (n) => String(n).padStart(2, '0');
let db,
  draws = [],
  games = [],
  syncing = false;
const meta = () => safeJSON(localStorage.getItem(META_KEY), {});
function safeJSON(s, fallback) {
  try {
    return s ? JSON.parse(s) : fallback;
  } catch {
    return fallback;
  }
}
function allDraws(t) {
  return draws.filter((d) => d.type === t).sort((a, b) => a.contest - b.contest);
}
function latestDraw(t) {
  const a = allDraws(t);
  return a[a.length - 1] || null;
}
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(STORE)) {
        const s = d.createObjectStore(STORE, { keyPath: 'id' });
        s.createIndex('typeContest', ['type', 'contest'], { unique: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function dbGetAll() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly'),
      r = tx.objectStore(STORE).getAll();
    r.onsuccess = () => resolve(r.result || []);
    r.onerror = () => reject(r.error);
  });
}
function dbPutMany(rows) {
  return new Promise((resolve, reject) => {
    if (!rows.length) return resolve();
    const tx = db.transaction(STORE, 'readwrite'),
      s = tx.objectStore(STORE);
    rows.forEach((d) => s.put({ ...d, id: `${d.type}:${d.contest}` }));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
function dbClear() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
function persistMeta(patch) {
  const m = { ...meta(), ...patch };
  localStorage.setItem(META_KEY, JSON.stringify(m));
  return m;
}
function parseNums(s) {
  return [...new Set((String(s || '').match(/\d+/g) || []).map(Number))].sort((a, b) => a - b);
}
function fmtDate(s) {
  if (!s) return '—';
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}
function dateToISO(s) {
  const m = String(s || '').match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!m) return '';
  const d = new Date(+m[3], +m[2] - 1, +m[1]);
  return d.getFullYear() === +m[3] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[1]
    ? `${m[3]}-${pad(m[2])}-${pad(m[1])}`
    : '';
}
function esc(s) {
  return String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}
function drawKey(d) {
  const keyNumbers = d.type === 'supersete' ? d.columns || d.numbers : d.numbers;
  return (
    keyNumbers.map((n) => (Array.isArray(n) ? n.map(pad).join('.') : pad(n))).join('-') +
    (d.columns && d.type !== 'supersete' ? `|${d.columns.join('')}` : '') +
    (d.trevos ? `|T${d.trevos.join('-')}` : '') +
    (d.month ? `|M${d.month}` : '') +
    (d.team ? `|${d.team}` : '')
  );
}
function matchesHistorical(game, draw) {
  if (game.type === 'duplasena') {
    const k = drawKey(game);
    return (
      k === drawKey({ ...draw, numbers: draw.numbers }) ||
      Boolean(
        draw.secondNumbers?.length && k === drawKey({ ...draw, numbers: draw.secondNumbers, secondNumbers: undefined }),
      )
    );
  }
  return drawKey(game) === drawKey(draw);
}
const isVirada = (d) =>
  d.type === 'megasena' && (d.specialDraw === 'mega-da-virada' || String(d.date || '').endsWith('-12-31'));
// Mega da Virada é um concurso especial da Mega-Sena: o filtro "virada" restringe a análise a essas edições.
const scopeOf = (id, t) => (t === 'megasena' && $(id) && $(id).value === 'virada' ? 'virada' : 'all');
const genScope = (t) => scopeOf('scope', t);
function periodDraws(t, p = 'all', scope = 'all') {
  const a = scope === 'virada' ? allDraws(t).filter(isVirada) : allDraws(t);
  return p === 'all' ? a : a.slice(-Number(p));
}
function dateFilteredDraws(t, p = 'all', from = '', to = '', scope = 'all') {
  return periodDraws(t, p, scope).filter(
    (d) => (!from && !to) || (Boolean(d.date) && (!from || d.date >= from) && (!to || d.date <= to)),
  );
}
function parseMonth(value) {
  if (Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 12) return Number(value);
  const normalized = String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .trim();
  const idx = MONTHS.findIndex(
    (m) =>
      m
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase('pt-BR') === normalized,
  );
  return idx >= 0 ? idx + 1 : NaN;
}
// ===== Sincronização com o espelho público (data/index.json + um arquivo por modalidade) =====
// Regra: a base completa é baixada UMA vez; depois disso o app não consulta a rede sozinho.
// Só o botão "Atualizar resultados" busca novidades (e só baixa as modalidades que mudaram).
const tick = () => new Promise((r) => setTimeout(r, 0));
async function fetchJSON(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw Error(`HTTP ${response.status} ao ler ${url}`);
  return response.json();
}
const isValidDraw = (d) =>
  CFG[d.type] && Number.isInteger(Number(d.contest)) && Number(d.contest) > 0 && Array.isArray(d.numbers);

async function loadPublishedResults({ force = false, onProgress = () => {} } = {}) {
  const index = await fetchJSON('./data/index.json');
  if (index.schemaVersion !== 2 || typeof index.modalities !== 'object')
    throw Error('Formato do espelho público inválido.');
  const stamps = meta().stamps || {},
    newStamps = { ...stamps },
    failed = [],
    before = draws.length,
    todo = Object.entries(index.modalities).filter(
      ([type, info]) =>
        CFG[type] && info?.file && (force || stamps[type] !== info.updatedAt || allDraws(type).length < info.count),
    );
  for (const [i, [type, info]] of todo.entries()) {
    onProgress(i, todo.length, CFG[type].label);
    await tick(); // deixa a tela responder entre uma modalidade e outra
    try {
      const payload = await fetchJSON('./data/' + info.file);
      const valid = (payload.draws || []).filter(isValidDraw);
      for (let k = 0; k < valid.length; k += 1000) {
        await dbPutMany(valid.slice(k, k + 1000));
        await tick();
      }
      mergeDraws(valid);
      newStamps[type] = info.updatedAt;
      logSync(`${CFG[type].label}: ${valid.length.toLocaleString('pt-BR')} concursos verificados.`);
      renderAll(); // os cartões vão sendo preenchidos enquanto o restante carrega
    } catch (e) {
      failed.push(CFG[type].label);
      logSync(`${CFG[type].label}: falha ao carregar (${e.message}).`);
    }
  }
  onProgress(todo.length, todo.length, '');
  const missing = Object.values(index.modalities).reduce((s, m) => s + (m.missing || 0), 0);
  persistMeta({
    publishedAt: index.generatedAt,
    publishedStatus: index.status,
    publishedMissing: missing,
    publishedModalities: index.modalities,
    publishedErrors: index.errors || [],
    stamps: newStamps,
    lastVerified: new Date().toISOString(),
  });
  return { index, added: draws.length - before, failed, missing, checked: todo.length };
}
function logSync(s) {
  const el = $('syncLog');
  el.textContent = (s + '\n' + el.textContent).slice(0, 6000);
}
function setSyncState(active) {
  syncing = active;
  $('syncLatest').disabled = active;
  $('syncForce').disabled = active;
  $('syncLatest').textContent = active ? 'Atualizando…' : 'Atualizar resultados';
  $('syncProgress').hidden = !active;
}
function actionsUrl() {
  const m = location.hostname.match(/^([^.]+)\.github\.io$/),
    repo = location.pathname.split('/')[1];
  return m && repo ? `https://github.com/${m[1]}/${repo}/actions` : null;
}
const pendingText = (n) =>
  `O servidor ainda está completando o histórico (faltam ${n.toLocaleString('pt-BR')} concursos); clique em Atualizar resultados mais tarde para baixar o que já foi publicado.`;
function idleMessage() {
  const m = meta();
  $('substatus').textContent = draws.length
    ? 'Dados salvos neste dispositivo. O app só busca novidades quando você clica em Atualizar resultados.' +
      (m.publishedMissing ? ' ' + pendingText(m.publishedMissing) : '')
    : 'A base ainda não foi baixada.';
}
// O app continua utilizável durante a atualização: nada aqui bloqueia a interface.
async function updateLatest(opts = {}) {
  if (syncing) return;
  setSyncState(true);
  renderDashboard();
  renderStatus();
  $('syncProgress').removeAttribute('value'); // barra indeterminada até saber quantas modalidades
  $('substatus').textContent = 'Atualizando em segundo plano… você pode continuar usando o app.';
  try {
    const { added, failed, missing, checked, index } = await loadPublishedResults({
      ...opts,
      onProgress: (i, n, label) => {
        if (n) $('syncProgress').value = Math.round((100 * i) / n);
        if (label) $('substatus').textContent = `Atualizando ${label} (${i + 1} de ${n})… pode continuar usando o app.`;
      },
    });
    renderAll();
    if (!draws.length) {
      $('substatus').textContent = 'O espelho público ainda não contém resultados.';
      logSync('Espelho vazio: execute o workflow “Atualizar resultados CAIXA” no GitHub Actions.');
    } else {
      $('substatus').textContent = added
        ? `${added.toLocaleString('pt-BR')} novo(s) resultado(s) baixado(s).`
        : checked
          ? 'Dados verificados; nenhum concurso novo.'
          : 'Você já está com os resultados mais recentes publicados.';
      if (missing) $('substatus').textContent += ' ' + pendingText(missing);
      if (index.status === 'partial' && !missing)
        $('substatus').textContent += ' (O servidor registrou avisos; veja a aba Base de dados.)';
    }
    if (failed.length) $('substatus').textContent += ` Falha ao carregar: ${failed.join(', ')}.`;
  } catch (e) {
    $('substatus').textContent = navigator.onLine
      ? 'Não foi possível ler o espelho público. Os dados já salvos neste dispositivo foram preservados.'
      : 'Sem conexão: usando os dados salvos neste dispositivo.';
    logSync('Falha ao ler o espelho público: ' + e.message);
  } finally {
    setSyncState(false);
    renderDashboard();
    renderStatus();
  }
}
function mergeDraws(rows) {
  const m = new Map(draws.map((d) => [`${d.type}:${d.contest}`, d]));
  rows.forEach((d) => m.set(`${d.type}:${d.contest}`, d));
  draws = [...m.values()].sort((a, b) => a.type.localeCompare(b.type) || a.contest - b.contest);
}
// Aviso quando os dados podem estar desatualizados (o app só busca novidades quando o usuário pede).
function staleMessage() {
  if (!draws.length) return '';
  const m = meta(),
    days = m.lastVerified ? (Date.now() - new Date(m.lastVerified)) / 864e5 : null,
    newest = draws.reduce((s, d) => (d.date > s ? d.date : s), ''),
    age = newest ? (Date.now() - new Date(newest + 'T12:00:00')) / 864e5 : 0;
  if (days !== null && days >= 3) return `⚠ Última verificação há ${Math.floor(days)} dias. Clique em Atualizar resultados.`;
  if (age >= 5) return `⚠ O resultado mais recente salvo aqui é de ${fmtDate(newest)}. Clique em Atualizar resultados.`;
  return '';
}
function renderStatus() {
  const count = draws.length,
    by = Object.keys(CFG)
      .map((t) => `${CFG[t].label}: ${allDraws(t).length}`)
      .join(' · '),
    megaVirada = draws.filter(isVirada).length;
  $('status').textContent = count
    ? count.toLocaleString('pt-BR') + ' concursos armazenados'
    : 'Base ainda não sincronizada';
  $('emptyHelp').hidden = count > 0 || syncing;
  const stale = staleMessage();
  $('staleNote').hidden = !stale;
  $('staleNote').textContent = stale;
  const link = actionsUrl();
  if (link) $('actionsLink').href = link;
  else $('actionsLink').removeAttribute('href');
  $('overview').textContent =
    by +
    (megaVirada ? ` · Mega da Virada: ${megaVirada} edições` : ' · Mega da Virada: incluída no histórico da Mega-Sena');
}
let selected = ''; // modalidade escolhida no painel (ou 'virada')
function nextText(t) {
  const n = (meta().publishedModalities || {})[t]?.next;
  return n && n.date >= new Date().toISOString().slice(0, 10) ? `Próximo: nº ${n.contest} · ${fmtDate(n.date)}` : '';
}
function cardMarkup(t, key = t) {
  const virada = key === 'virada',
    a = virada ? allDraws('megasena').filter(isVirada) : allDraws(t),
    last = a[a.length - 1],
    next = virada ? '' : nextText(t);
  return `<article class="mod-card" data-type="${t}" data-key="${key}" data-selected="${selected === key}"><b>${virada ? 'Mega da Virada' : CFG[t].label}</b><strong>${a.length.toLocaleString('pt-BR')}</strong><small>${virada ? 'edições no histórico da Mega-Sena' : 'concursos armazenados'}</small><small>Último: ${last ? `nº ${last.contest} · ${fmtDate(last.date)}` : 'não disponível'}</small>${next ? `<small class="next">${next}</small>` : ''}<span class="card-actions"><button type="button" class="mini" data-go="generator">Gerar jogo</button><button type="button" class="mini" data-go="stats">Estatísticas</button></span></article>`;
}
function renderDashboard() {
  const m = meta();
  $('modalityCards').innerHTML =
    !draws.length && syncing
      ? Array.from({ length: 10 }, () => '<article class="mod-card skeleton" aria-hidden="true"><b></b><strong></strong><small></small><small></small></article>').join('')
      : Object.keys(CFG)
          .map((t) => cardMarkup(t))
          .join('') + cardMarkup('megasena', 'virada');
  $('modalityCards').setAttribute('aria-busy', String(!draws.length && syncing));
  $('lastSync').textContent = m.publishedAt
    ? 'Dados atualizados em: ' + new Date(m.publishedAt).toLocaleString('pt-BR')
    : 'Espelho ainda não publicado';
  document.querySelectorAll('#modalityCards .mod-card:not(.skeleton)').forEach((c) => {
    c.onclick = (e) => {
      const go = e.target.closest('[data-go]');
      selectModality(c.dataset.key);
      if (go) $('tab-' + go.dataset.go).click();
    };
  });
}
// Clique em um jogo do painel: marca o cartão e usa a modalidade no Gerador, Estatísticas e Análises.
function selectModality(key) {
  selected = key;
  const t = key === 'virada' ? 'megasena' : key;
  ['type', 'statsType', 'analysisType'].forEach((id) => ($(id).value = t));
  ['scope', 'statsScope', 'analysisScope'].forEach((id) => ($(id).value = key === 'virada' ? 'virada' : 'all'));
  updatePick();
  syncGameButtons();
  renderDashboard();
}
function syncGameButtons() {
  document
    .querySelectorAll('.game-btn')
    .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.key === selected)));
}
function renderAll() {
  renderStatus();
  renderDashboard();
  renderStats();
  renderAnalysis();
  renderSaved();
  renderCheck();
  renderDiagnostics();
}
function fillModalities() {
  const opts = Object.entries(CFG).map(([k, v]) => new Option(v.label, k));
  ['type', 'statsType', 'analysisType', 'importType'].forEach((id) => {
    const s = $(id);
    s.replaceChildren(...opts.map((o) => o.cloneNode(true)));
  });
}
function updatePick() {
  const t = $('type').value,
    c = CFG[t],
    s = $('pick');
  s.replaceChildren();
  for (let i = c.min; i <= c.maxPick; i++) s.add(new Option(i + ' números', i));
  $('pick').value = String(c.base);
  $('pickField').hidden = t === 'supersete';
  $('scopeField').hidden = t !== 'megasena';
  $('fixedField').hidden = t === 'supersete';
  $('excludedField').hidden = t === 'supersete';
  renderSpecialFields();
}
function renderSpecialFields() {
  const t = $('type').value,
    c = CFG[t],
    el = $('specialFields');
  let html = '';
  if (t === 'diadesorte')
    html = `<label>Mês da sorte<select id="monthPick"><option value="">Sortear mês</option>${MONTHS.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('')}</select></label>`;
  if (t === 'timemania')
    html = '<label>Time do coração<input id="teamPick" placeholder="Ex.: Flamengo/RJ" required></label>';
  if (t === 'maismilionaria')
    html =
      '<label>Trevos fixos (opcional)<input id="trevosFixed" placeholder="Dois trevos entre 1 e 6"></label><label>Trevos excluídos<input id="trevosExcluded" placeholder="Trevos a excluir"></label>';
  if (t === 'supersete')
    html = `<div class="detail-card"><b>Quantidade por coluna</b><p>Escolha de 1 a 3 dígitos por coluna. As regras de quantidade total serão validadas antes de gerar o jogo.</p></div>${Array.from({ length: 7 }, (_, i) => `<label>Coluna ${i + 1}<select id="colCount${i + 1}"><option value="1" selected>1 dígito</option><option value="2">2 dígitos</option><option value="3">3 dígitos</option></select></label>`).join('')}`;
  if (t === 'lotomania')
    html =
      '<div class="detail-card"><b>Lotomania</b><p>São selecionados exatamente 50 números de 00 a 99. A análise também considera a faixa de zero acertos.</p></div>';
  el.innerHTML = html;
}
function weightedPick(pool, count, weights) {
  let p = pool.slice(),
    out = [];
  while (out.length < count && p.length) {
    let sum = p.reduce((s, n) => s + Math.max(0.001, weights?.[n] ?? 1), 0),
      r = Math.random() * sum,
      chosen = p[0];
    for (const n of p) {
      r -= Math.max(0.001, weights?.[n] ?? 1);
      if (r <= 0) {
        chosen = n;
        break;
      }
    }
    out.push(chosen);
    p = p.filter((n) => n !== chosen);
  }
  return out;
}
function statsFor(t, period = 'all', from = '', to = '', scope = 'all') {
  const cfg = CFG[t],
    a = dateFilteredDraws(t, period, from, to, scope),
    freq = Array(cfg.max + 1).fill(0),
    last = Array(cfg.max + 1).fill(-1);
  a.forEach((d, i) =>
    [...d.numbers, ...(d.secondNumbers || [])].forEach((n) => {
      freq[n]++;
      last[n] = i;
    }),
  );
  const delay = last.map((v, i) => (v < 0 ? a.length : a.length - 1 - v)),
    totalSlots = a.length * (t === 'duplasena' ? 2 : t === 'supersete' ? 7 : 1);
  return { a, freq, last, delay, totalSlots };
}
function sampleGame(t, count, strategy, period, fixed, excluded) {
  const cfg = CFG[t],
    { a, freq, delay, totalSlots } = statsFor(t, period, '', '', genScope(t)),
    recent = statsFor(t, '20', '', '', genScope(t));
  let pool = Array.from({ length: cfg.max + (cfg.zero ? 1 : 0) }, (_, i) => i + (cfg.zero ? 0 : 1)).filter(
      (n) => !fixed.includes(n) && !excluded.includes(n),
    ),
    need = count - fixed.length;
  if (need < 0 || pool.length < need) throw Error('Os filtros não permitem completar a quantidade selecionada.');
  let w = {};
  pool.forEach((n) => {
    const f = freq[n],
      d = delay[n];
    w[n] =
      strategy === 'hot'
        ? f + 0.2
        : strategy === 'cold'
          ? Math.max(1, totalSlots - f)
          : strategy === 'overdue'
            ? d + 1
            : strategy === 'recentHot'
              ? recent.freq[n] + 0.2
              : strategy === 'recentCold'
                ? Math.max(1, recent.totalSlots - recent.freq[n])
                : 1;
  });
  let chosen = [];
  if (strategy === 'mixed') {
    const hot = weightedPick(pool, Math.ceil(need / 2), Object.fromEntries(pool.map((n) => [n, freq[n] + 0.2]))),
      rest = pool.filter((n) => !hot.includes(n));
    chosen = hot.concat(
      weightedPick(
        rest,
        need - hot.length,
        Object.fromEntries(rest.map((n) => [n, Math.max(1, totalSlots - freq[n])])),
      ),
    );
  } else if (strategy === 'balanced') {
    const fixedOdd = fixed.filter((n) => n % 2).length,
      targetOdd = Math.round(count / 2),
      oddNeed = Math.max(0, Math.min(need, targetOdd - fixedOdd)),
      odd = pool.filter((n) => n % 2),
      even = pool.filter((n) => n % 2 === 0);
    chosen = weightedPick(odd, oddNeed, {}).concat(weightedPick(even, need - oddNeed, {}));
    if (chosen.length < need)
      chosen = chosen.concat(
        weightedPick(
          pool.filter((n) => !chosen.includes(n)),
          need - chosen.length,
          {},
        ),
      );
  } else if (strategy === 'bands') {
    const numberMin = cfg.zero ? 0 : 1,
      bandSize = Math.ceil((cfg.max - numberMin + 1) / 5),
      bands = Array.from({ length: 5 }, (_, i) =>
        pool.filter((n) => n >= numberMin + i * bandSize && n < numberMin + (i + 1) * bandSize),
      );
    let left = need;
    for (let i = 0; i < bands.length; i++) {
      const take =
        i === bands.length - 1 ? left : Math.min(left, Math.floor(need / 5) + (Math.random() < need % 5 ? 1 : 0));
      chosen.push(
        ...weightedPick(
          bands[i].filter((n) => !chosen.includes(n)),
          take,
          {},
        ),
      );
      left = need - chosen.length;
    }
    if (chosen.length < need)
      chosen.push(
        ...weightedPick(
          pool.filter((n) => !chosen.includes(n)),
          need - chosen.length,
          {},
        ),
      );
  } else chosen = weightedPick(pool, need, w);
  return [...fixed, ...chosen].sort((x, y) => x - y);
}
function createGame(t, strategy, period) {
  const cfg = CFG[t];
  if (t === 'supersete') {
    const counts = Array.from({ length: 7 }, (_, i) => Number($(`colCount${i + 1}`)?.value || 1)),
      total = counts.reduce((s, n) => s + n, 0);
    if (
      counts.some((n) => n < 1 || n > 3) ||
      !(
        total === 7 ||
        (total >= 8 && total <= 14 && counts.every((n) => n <= 2)) ||
        (total >= 15 && total <= 21 && counts.every((n) => n >= 2))
      )
    )
      throw Error(
        'Super Sete: 7 dígitos (1 por coluna), de 8 a 14 (1 ou 2 por coluna) ou de 15 a 21 (2 ou 3 por coluna).',
      );
    const { a, freq } = statsFor(t, period, '', '', genScope(t));
    const cols = counts.map((qty, col) => {
      const f = Array(10).fill(0);
      a.forEach((d) => {
        const v = d.numbers[col];
        if (Number.isInteger(v)) f[v]++;
      });
      let weights = {};
      for (let n = 0; n < 10; n++)
        weights[n] =
          strategy === 'hot'
            ? f[n] + 0.2
            : strategy === 'cold'
              ? Math.max(1, a.length - f[n])
              : strategy === 'recentHot'
                ? statsFor(t, '20', '', '', genScope(t)).freq[n] + 0.2
                : strategy === 'recentCold'
                  ? Math.max(
                      1,
                      statsFor(t, '20', '', '', genScope(t)).a.length - statsFor(t, '20', '', '', genScope(t)).freq[n],
                    )
                  : strategy === 'overdue'
                    ? 1 + Math.max(0, a.length - 1 - a.map((d) => d.numbers[col]).lastIndexOf(n))
                    : 1;
      return weightedPick(
        Array.from({ length: 10 }, (_, i) => i),
        qty,
        weights,
      ).sort((x, y) => x - y);
    });
    return { type: t, numbers: [], columns: cols, strategy, created: new Date().toISOString() };
  }
  let count = Number($('pick').value),
    fixed = parseNums($('fixed').value),
    excluded = parseNums($('excluded').value);
  if (t === 'lotomania' && count !== 50) count = 50;
  if (
    fixed.some((n) => n < (cfg.zero ? 0 : 1) || n > cfg.max) ||
    excluded.some((n) => n < (cfg.zero ? 0 : 1) || n > cfg.max)
  )
    throw Error(`Use números entre ${cfg.zero ? '00' : '01'} e ${pad(cfg.max)}.`);
  if (fixed.some((n) => excluded.includes(n))) throw Error('Um número não pode ser fixo e excluído.');
  if (fixed.length > count) throw Error('Há mais números fixos do que o tamanho do jogo.');
  let game = {
    type: t,
    numbers: sampleGame(t, count, strategy, period, fixed, excluded),
    strategy,
    created: new Date().toISOString(),
  };
  if (t === 'diadesorte') game.month = Number($('monthPick')?.value) || 1 + Math.floor(Math.random() * 12);
  if (t === 'timemania') {
    game.team = String($('teamPick')?.value || '').trim();
    if (!game.team) throw Error('Informe o time do coração da Timemania.');
  }
  if (t === 'maismilionaria') {
    const tf = parseNums($('trevosFixed')?.value),
      te = parseNums($('trevosExcluded')?.value);
    if (
      tf.length > 2 ||
      tf.some((n) => n < 1 || n > 6) ||
      te.some((n) => n < 1 || n > 6) ||
      tf.some((n) => te.includes(n))
    )
      throw Error('Confira os trevos fixos/excluídos (1 a 6; dois fixos no máximo).');
    const tp = [1, 2, 3, 4, 5, 6].filter((n) => !te.includes(n) && !tf.includes(n));
    if (tp.length < 2 - tf.length) throw Error('Não há trevos disponíveis.');
    game.trevos = tf.concat(weightedPick(tp, 2 - tf.length, {})).sort((a, b) => a - b);
  }
  return game;
}
function gameMarkup(g, i, saved = false) {
  const sc = saved ? lastScore(g) : null,
    tier = sc ? tierOf(g.type, sc.res) : '',
    result = sc
      ? `<p class="res-sum"><b>Último concurso (nº ${sc.d.contest}, ${fmtDate(sc.d.date)}):</b> ${summaryText(g, sc.res)}${tier ? ` · 🎉 ${esc(tier)}` : ''}</p>`
      : '';
  return `<article class="game${tier ? ' win' : ''}" data-type="${g.type}"><div class="gamehead"><span>${CFG[g.type].label} · Jogo ${i + 1}</span><span class="head-actions">${shareButtons(g)}${saved ? `<button type="button" class="mini" data-del="${i}">Excluir</button>` : ''}</span></div><div class="balls">${ballsMarkup(g, sc?.res)}</div>${g.secondNumbers ? `<small>2º sorteio: ${g.secondNumbers.map(pad).join(' · ')}</small>` : ''}${result}<div class="meta">${esc(g.strategy || 'Salvo')}${extrasText(g)} · ${g.created ? new Date(g.created).toLocaleString('pt-BR') : ''}</div></article>`;
}
function renderGames(id, list, saved = false) {
  const el = $(id);
  el.classList.toggle('empty', !list.length);
  el.innerHTML = list.length ? list.map((g, i) => gameMarkup(g, i, saved)).join('') : 'Nenhum jogo disponível.';
  el.querySelectorAll('[data-del]').forEach(
    (b) =>
      (b.onclick = () => {
        const a = safeJSON(localStorage.getItem(SAVED_KEY), []);
        a.splice(Number(b.dataset.del), 1);
        localStorage.setItem(SAVED_KEY, JSON.stringify(a));
        renderSaved();
      }),
  );
}
function renderSaved() {
  renderGames('savedCards', safeJSON(localStorage.getItem(SAVED_KEY), []), true);
}
function renderStats() {
  $('statsScopeField').hidden = $('statsType').value !== 'megasena';
  const t = $('statsType').value || 'megasena',
    p = $('statsPeriod').value || 'all',
    cfg = CFG[t],
    { a, freq, delay, totalSlots } = statsFor(t, p, $('statsFrom').value, $('statsTo').value, scopeOf('statsScope', t));
  let arr = Array.from(
    { length: cfg.max + (cfg.zero || cfg.digit ? 1 : 0) },
    (_, i) => i + (cfg.zero || cfg.digit ? 0 : 1),
  );
  const sort = $('sort').value;
  if (sort === 'desc') arr.sort((x, y) => freq[y] - freq[x] || x - y);
  if (sort === 'asc') arr.sort((x, y) => freq[x] - freq[y] || x - y);
  if (sort === 'delay') arr.sort((x, y) => delay[y] - delay[x] || x - y);
  if (sort === 'num') arr.sort((x, y) => x - y);
  const max = Math.max(1, ...arr.map((n) => freq[n]));
  $('summary').innerHTML =
    `<div><b>${a.length.toLocaleString('pt-BR')}</b><small>Concursos analisados</small></div><div><b>${cfg.max + 1 * (cfg.zero || cfg.digit ? 1 : 0)}</b><small>Números possíveis</small></div><div><b>${a.length ? Math.max(...freq) : '—'}</b><small>Maior frequência</small></div><div><b>${a.length ? Math.min(...arr.map((n) => freq[n])) : '—'}</b><small>Menor frequência</small></div>`;
  $('ranking').classList.toggle('empty', !a.length);
  $('ranking').dataset.type = t;
  renderStatsCharts(t, a, freq, delay, totalSlots);
  $('ranking').innerHTML = a.length
    ? arr
        .map(
          (n) =>
            `<div class="rank" style="--heat:${(freq[n] / max).toFixed(2)}"><strong>${pad(n)}</strong><span><b>${freq[n]}</b><br><small>${totalSlots ? ((100 * freq[n]) / totalSlots).toFixed(1).replace('.', ',') : '0'}% das posições · atraso ${delay[n]}</small><div class="bar"><i style="width:${(100 * freq[n]) / max}%"></i></div></span></div>`,
        )
        .join('')
    : 'Nenhum concurso carregado para esta modalidade.';
  const total = a.length ? a.reduce((s, d) => s + d.numbers.reduce((x, n) => x + n, 0), 0) / a.length : 0;
  const odd = a.length ? a.reduce((s, d) => s + d.numbers.filter((n) => n % 2).length, 0) / a.length : 0;
  const prev =
    a.length > 1
      ? a.slice(1).reduce((s, d, i) => s + d.numbers.filter((n) => a[i].numbers.includes(n)).length, 0) / (a.length - 1)
      : 0;
  $('statsDetails').innerHTML = a.length
    ? `<article class="detail-card"><b>Média por concurso</b><p>Soma média das dezenas: ${total.toFixed(1).replace('.', ',')}</p><p>Média de ímpares: ${odd.toFixed(2).replace('.', ',')}</p></article><article class="detail-card"><b>Repetição entre concursos</b><p>Média de números repetidos em relação ao concurso anterior: ${prev.toFixed(2).replace('.', ',')}</p></article><article class="detail-card"><b>Intervalo da base</b><p>Primeiro concurso armazenado: ${a[0].contest}</p><p>Último concurso armazenado: ${a[a.length - 1].contest}</p></article>`
    : '';
}
function renderAnalysis() {
  $('analysisScopeField').hidden = $('analysisType').value !== 'megasena';
  const t = $('analysisType').value || 'megasena',
    a = dateFilteredDraws(
      t,
      $('analysisPeriod').value || 'all',
      $('analysisFrom').value,
      $('analysisTo').value,
      scopeOf('analysisScope', t),
    ),
    cfg = CFG[t];
  if (!a.length) {
    $('analysisOutput').innerHTML = '<div class="detail-card">Sem histórico para esta modalidade.</div>';
    return;
  }
  const events = a.flatMap((d) => [d.numbers, ...(d.secondNumbers ? [d.secondNumbers] : [])]),
    sums = events.map((nums) => nums.reduce((s, n) => s + n, 0)),
    odd = events.map((nums) => nums.filter((n) => n % 2).length),
    repeat = a.slice(1).map((d, i) => d.numbers.filter((n) => a[i].numbers.includes(n)).length),
    runs = events.map((nums) => {
      let s = 0,
        b = 0,
        p = -2;
      nums.forEach((n) => {
        if (n === p + 1) s++;
        else s = 1;
        b = Math.max(b, s);
        p = n;
      });
      return b;
    });
  const avg = (x) => (x.length ? (x.reduce((s, n) => s + n, 0) / x.length).toFixed(2).replace('.', ',') : '—');
  const bins = Array.from({ length: 5 }, (_, i) =>
    events.reduce(
      (s, nums) =>
        s +
        nums.filter((n) => n >= i * Math.ceil((cfg.max + 1) / 5) && n < (i + 1) * Math.ceil((cfg.max + 1) / 5)).length,
      0,
    ),
  );
  $('analysisOutput').innerHTML =
    `<article class="detail-card"><b>Soma das dezenas</b><p>Média: ${avg(sums)}</p><p>Menor/maior: ${Math.min(...sums)} / ${Math.max(...sums)}</p></article><article class="detail-card"><b>Pares e ímpares</b><p>Média de ímpares por concurso: ${avg(odd)}</p><p>O restante corresponde a pares.</p></article><article class="detail-card"><b>Repetição do concurso anterior</b><p>Média: ${avg(repeat)} número(s)</p></article><article class="detail-card"><b>Sequências consecutivas</b><p>Maior sequência média por concurso: ${avg(runs)}</p><p>Maior sequência observada: ${Math.max(...runs)}</p></article><article class="detail-card"><b>Faixas numéricas</b>${bins.map((v, i) => `<p>Faixa ${i + 1}: ${v} ocorrências</p>`).join('')}</article><article class="detail-card"><b>Recorte analisado</b><p>${a.length} concursos</p><p>De ${fmtDate(a[0].date)} até ${fmtDate(a[a.length - 1].date)}</p></article>${(() => {
      const months = Array(12).fill(0);
      a.forEach((d) => {
        const m = Number((d.date || '').slice(5, 7));
        if (m >= 1 && m <= 12) months[m - 1]++;
      });
      let extra = `<article class="detail-card"><b>Concursos por mês do calendário</b>${months.map((v, i) => `<p>${MONTHS[i]}: ${v}</p>`).join('')}</article>`;
      if (t === 'diadesorte') {
        const luck = Array(12).fill(0);
        a.forEach((d) => {
          if (d.month >= 1 && d.month <= 12) luck[d.month - 1]++;
        });
        extra += `<article class="detail-card"><b>Mês da sorte</b>${luck.map((v, i) => `<p>${MONTHS[i]}: ${v}</p>`).join('')}</article>`;
      }
      if (t === 'maismilionaria') {
        const trev = Array(7).fill(0);
        a.forEach((d) =>
          (d.trevos || []).forEach((n) => {
            if (n >= 1 && n <= 6) trev[n]++;
          }),
        );
        extra += `<article class="detail-card"><b>Frequência dos trevos</b>${trev
          .slice(1)
          .map((v, i) => `<p>Trevo ${i + 1}: ${v}</p>`)
          .join('')}</article>`;
      }
      if (t === 'timemania') {
        const teams = {};
        a.forEach((d) => {
          if (d.team) teams[d.team] = (teams[d.team] || 0) + 1;
        });
        extra += `<article class="detail-card"><b>Times mais sorteados</b>${
          Object.entries(teams)
            .sort((x, y) => y[1] - x[1])
            .slice(0, 10)
            .map(([name, v]) => `<p>${esc(name)}: ${v}</p>`)
            .join('') || '<p>Sem informação de time.</p>'
        }</article>`;
      }
      return extra;
    })()}`;
}
function backtest() {
  const saved = safeJSON(localStorage.getItem(SAVED_KEY), []);
  if (!saved.length) {
    $('backtestOutput').textContent = 'Salve ao menos um jogo para executar a comparação.';
    return;
  }
  let html = '';
  saved.forEach((g) => {
    const a = allDraws(g.type);
    let best = 0,
      bestExtra = 0,
      counts = {};
    a.forEach((d) => {
      let hits;
      if (g.type === 'supersete')
        hits = g.columns.filter((choice, i) =>
          (Array.isArray(choice) ? choice : [choice]).includes(d.numbers[i]),
        ).length;
      else if (g.type === 'duplasena') {
        const h1 = g.numbers.filter((n) => d.numbers.includes(n)).length,
          h2 = g.numbers.filter((n) => (d.secondNumbers || []).includes(n)).length;
        hits = Math.max(h1, h2);
      } else hits = g.numbers.filter((n) => d.numbers.includes(n)).length;
      let extra = 0;
      if (g.type === 'maismilionaria') extra = (g.trevos || []).filter((n) => (d.trevos || []).includes(n)).length;
      if (g.type === 'diadesorte' && g.month === d.month) extra = 1;
      if (g.type === 'timemania' && g.team && d.team && g.team.toLocaleLowerCase() === d.team.toLocaleLowerCase())
        extra = 1;
      best = Math.max(best, hits);
      bestExtra = Math.max(bestExtra, extra);
      counts[hits] = (counts[hits] || 0) + 1;
    });
    html += `<article class="detail-card"><b>${CFG[g.type].label}</b><p>Melhor quantidade de acertos principais: ${best}</p>${['maismilionaria', 'diadesorte', 'timemania'].includes(g.type) ? `<p>Melhor acerto do campo adicional: ${bestExtra}</p>` : ''}<p>Concursos comparados: ${a.length}</p><p>Distribuição de acertos principais: ${
      Object.keys(counts)
        .sort((x, y) => Number(x) - Number(y))
        .map((k) => `${k}: ${counts[k]}`)
        .join(' · ') || 'Sem dados'
    }</p></article>`;
  });
  $('backtestOutput').innerHTML = `<div class="analysis-grid">${html}</div>`;
}
function csvEscape(v) {
  const s = String(v ?? '');
  return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function download(name, content, type = 'text/plain;charset=utf-8') {
  const blob = new Blob(['\ufeff', content], { type }),
    url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
function exportDraws() {
  const head = 'modalidade,concurso,data,dezenas,segundo_sorteio,trevos,mes_sorte,time_coracao,colunas';
  const rows = draws.map((d) =>
    [
      d.type,
      d.contest,
      fmtDate(d.date),
      d.numbers.join(' '),
      (d.secondNumbers || []).join(' '),
      (d.trevos || []).join(' '),
      d.month || '',
      d.team || '',
      (d.columns || []).join(' '),
    ]
      .map(csvEscape)
      .join(','),
  );
  download('historico-loterias-caixa.csv', [head, ...rows].join('\n'), 'text/csv;charset=utf-8');
}
function csvParse(text) {
  const rows = [];
  let row = [],
    field = '',
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',' || c === ';') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}
async function importCSV(file) {
  const t = $('importType').value,
    cfg = CFG[t],
    rows = csvParse(await file.text());
  if (!rows.length) throw Error('Arquivo vazio.');
  let start = /concurso|data|dezena/i.test(rows[0].join(' ')) ? 1 : 0,
    parsed = [];
  for (let i = start; i < rows.length; i++) {
    const r = rows[i],
      contest = Number(r[0]);
    if (!Number.isInteger(contest) || contest < 1) continue;
    const date = dateToISO(r[1]);
    if (!date) continue;
    const nums = r
      .slice(2)
      .filter((x) => /^\d{1,2}$/.test(x.trim()))
      .map(Number);
    if (nums.length < cfg.mainCount) continue;
    const d = { type: t, contest, date, numbers: nums.slice(0, cfg.mainCount) };
    if (t === 'duplasena') d.secondNumbers = nums.slice(cfg.mainCount, cfg.mainCount + 6);
    if (t === 'maismilionaria') d.trevos = nums.slice(cfg.mainCount, cfg.mainCount + 2);
    if (t === 'diadesorte') d.month = parseMonth(r[r.length - 1]);
    if (t === 'supersete') d.columns = d.numbers.slice();
    const validNumbers = d.numbers.every(
      (n) => Number.isInteger(n) && (t === 'supersete' ? n >= 0 && n <= 9 : n >= (cfg.zero ? 0 : 1) && n <= cfg.max),
    );
    if (!validNumbers || (t !== 'supersete' && new Set(d.numbers).size !== d.numbers.length)) continue;
    if (
      t === 'duplasena' &&
      (d.secondNumbers.length !== 6 ||
        d.secondNumbers.some((n) => n < 1 || n > 50) ||
        new Set(d.secondNumbers).size !== 6)
    )
      continue;
    if (
      t === 'maismilionaria' &&
      (d.trevos.length !== 2 || d.trevos.some((n) => n < 1 || n > 6) || new Set(d.trevos).size !== 2)
    )
      continue;
    if (t === 'diadesorte' && !(d.month >= 1 && d.month <= 12)) continue;
    parsed.push(d);
  }
  if (!parsed.length) throw Error('Nenhum concurso válido encontrado. Confira o formato e a quantidade de dezenas.');
  await dbPutMany(parsed);
  mergeDraws(parsed);
  renderAll();
  $('importMsg').textContent = `${parsed.length} concurso(s) importado(s).`;
}
function backup() {
  const payload = {
    format: 'loterias-caixa-backup-v2',
    created: new Date().toISOString(),
    draws,
    saved: safeJSON(localStorage.getItem(SAVED_KEY), []),
    meta: meta(),
  };
  download('backup-loterias-caixa.json', JSON.stringify(payload, null, 2), 'application/json');
}
async function restoreBackup(file) {
  const j = JSON.parse(await file.text());
  if (j.format !== 'loterias-caixa-backup-v2' || !Array.isArray(j.draws))
    throw Error('Arquivo de backup inválido ou incompatível.');
  await dbPutMany(j.draws);
  mergeDraws(j.draws);
  if (Array.isArray(j.saved)) localStorage.setItem(SAVED_KEY, JSON.stringify(j.saved));
  if (j.meta && typeof j.meta === 'object') persistMeta(j.meta);
  renderAll();
  $('importMsg').textContent = `Backup restaurado: ${j.draws.length} concursos.`;
}
function csvTemplate() {
  const t = $('importType').value,
    c = CFG[t];
  download(
    `modelo-${t}.csv`,
    `concurso,data,${Array.from({ length: c.mainCount }, (_, i) => 'n' + (i + 1)).join(',')}\n1,01/01/2000,${Array.from({ length: c.mainCount }, (_, i) => pad(i)).join(',')}`,
    'text/csv;charset=utf-8',
  );
}
function bind() {
  initCheck();
  const tabs = [...document.querySelectorAll('.tab')];
  const showTab = (b, focus = false) => {
    tabs.forEach((x) => {
      x.classList.toggle('active', x === b);
      x.setAttribute('aria-selected', String(x === b));
      x.tabIndex = x === b ? 0 : -1;
    });
    document.querySelectorAll('.panel').forEach((x) => x.classList.toggle('active', x.id === b.dataset.tab));
    if (focus) b.focus();
    if (b.dataset.tab !== 'check') stopCamera();
    if (b.dataset.tab === 'check') renderCheck();
    if (b.dataset.tab === 'stats') renderStats();
    if (b.dataset.tab === 'analysis') renderAnalysis();
    if (b.dataset.tab === 'saved') renderSaved();
    history.replaceState(null, '', '#' + b.dataset.tab);
  };
  tabs.forEach((b, i) => {
    b.onclick = () => showTab(b);
    b.onkeydown = (e) => {
      const k = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (k) {
        e.preventDefault();
        showTab(tabs[(i + k + tabs.length) % tabs.length], true);
      } else if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        showTab(tabs[e.key === 'Home' ? 0 : tabs.length - 1], true);
      }
    };
  });
  const fromHash = tabs.find((b) => b.dataset.tab === location.hash.slice(1));
  if (fromHash) showTab(fromHash);
  $('type').onchange = updatePick;
  $('statsType').onchange = renderStats;
  $('statsScope').onchange = renderStats;
  $('analysisScope').onchange = renderAnalysis;
  $('statsPeriod').onchange = renderStats;
  $('sort').onchange = renderStats;
  $('statsFrom').onchange = renderStats;
  $('statsTo').onchange = renderStats;
  $('analysisType').onchange = renderAnalysis;
  $('analysisPeriod').onchange = renderAnalysis;
  $('analysisFrom').onchange = renderAnalysis;
  $('analysisTo').onchange = renderAnalysis;
  $('generate').onclick = () => {
    try {
      const t = $('type').value,
        strategy = $('strategy').value,
        p = $('period').value,
        q = Math.max(1, Math.min(100, Number($('qty').value) || 1)),
        seen = new Set(),
        past = allDraws(t),
        out = [];
      let tries = 0;
      while (out.length < q && tries < q * 1000) {
        tries++;
        const g = createGame(t, strategy, p),
          k = drawKey(g);
        if ($('unique').checked && seen.has(k)) continue;
        if ($('avoid').checked && past.some((d) => matchesHistorical(g, d))) continue;
        seen.add(k);
        out.push(g);
      }
      if (out.length < q) throw Error('Não foi possível gerar todos os jogos com estes filtros. Ajuste os critérios.');
      games = out;
      renderGames('generated', games);
      $('msg').textContent =
        `${games.length} jogo(s) gerado(s). Histórico usado: ${periodDraws(t, p, genScope(t)).length} concurso(s)${genScope(t) === 'virada' ? ' (somente Mega da Virada)' : ''}.`;
    } catch (e) {
      $('msg').textContent = e.message;
    }
  };
  $('clear').onclick = () => {
    $('fixed').value = '';
    $('excluded').value = '';
    $('msg').textContent = 'Filtros limpos.';
    renderSpecialFields();
  };
  $('saveAll').onclick = () => {
    if (!games.length) {
      $('msg').textContent = 'Gere os jogos antes de salvar.';
      return;
    }
    const a = safeJSON(localStorage.getItem(SAVED_KEY), []);
    const existing = new Set(a.map(drawKey));
    games.forEach((g) => {
      if (!existing.has(drawKey(g))) a.push(g);
    });
    localStorage.setItem(SAVED_KEY, JSON.stringify(a));
    renderSaved();
    $('msg').textContent = 'Jogos salvos neste dispositivo.';
  };
  $('export').onclick = () =>
    download(
      'jogos-gerados.csv',
      [
        'modalidade,numeros,trevos,mes,time,colunas,estrategia',
        ...games.map((g) =>
          [
            CFG[g.type].label,
            (g.numbers || []).join(' '),
            (g.trevos || []).join(' '),
            g.month || '',
            g.team || '',
            (g.columns || []).map((c) => (Array.isArray(c) ? c.join('|') : c)).join(' '),
            g.strategy,
          ]
            .map(csvEscape)
            .join(','),
        ),
      ].join('\n'),
      'text/csv;charset=utf-8',
    );
  $('exportSaved').onclick = () => {
    const a = safeJSON(localStorage.getItem(SAVED_KEY), []);
    const head = 'modalidade,numeros,trevos,mes_sorte,time_coracao,colunas,estrategia';
    const rows = a.map((g) =>
      [
        CFG[g.type].label,
        (g.numbers || []).join(' '),
        (g.trevos || []).join(' '),
        g.month ? MONTHS[g.month - 1] : '',
        g.team || '',
        (g.columns || []).map((c) => (Array.isArray(c) ? c.join('|') : c)).join(' '),
        g.strategy || '',
      ]
        .map(csvEscape)
        .join(','),
    );
    download('jogos-salvos.csv', [head, ...rows].join('\n'), 'text/csv;charset=utf-8');
  };
  $('deleteSaved').onclick = () => {
    if (confirm('Apagar todos os jogos salvos?')) {
      localStorage.removeItem(SAVED_KEY);
      renderSaved();
    }
  };
  // Tema claro/escuro: segue o sistema até o usuário escolher; a escolha fica salva neste navegador.
  const root = document.documentElement,
    themeBtn = $('themeToggle'),
    paintTheme = () => {
      const dark = root.dataset.theme === 'dark';
      themeBtn.setAttribute('aria-label', dark ? 'Mudar para o tema claro' : 'Mudar para o tema escuro');
      themeBtn.title = dark ? 'Tema claro' : 'Tema escuro';
      $('metaTheme').content = dark ? '#14452a' : '#1d6e3a';
    };
  themeBtn.onclick = () => {
    root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem('lc_theme', root.dataset.theme);
    } catch (e) {}
    paintTheme();
  };
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (localStorage.getItem('lc_theme')) return;
    root.dataset.theme = e.matches ? 'dark' : 'light';
    paintTheme();
  });
  paintTheme();
  document.querySelectorAll('.game-btn').forEach((b) => (b.onclick = () => selectModality(b.dataset.key)));
  $('syncLatest').onclick = () => updateLatest();
  $('syncForce').onclick = () => updateLatest({ force: true });
  $('backtest').onclick = backtest;
  $('file').onchange = async (e) => {
    if (!e.target.files[0]) return;
    try {
      await importCSV(e.target.files[0]);
    } catch (err) {
      $('importMsg').textContent = err.message;
    }
    e.target.value = '';
  };
  $('template').onclick = csvTemplate;
  $('exportHistory').onclick = exportDraws;
  $('backup').onclick = backup;
  $('restore').onchange = async (e) => {
    if (!e.target.files[0]) return;
    try {
      await restoreBackup(e.target.files[0]);
    } catch (err) {
      $('importMsg').textContent = err.message;
    }
    e.target.value = '';
  };
  $('wipe').onclick = async () => {
    if (
      confirm('Apagar todos os concursos armazenados neste dispositivo? Esta ação não pode ser desfeita sem um backup.')
    ) {
      await dbClear();
      draws = [];
      localStorage.removeItem(META_KEY);
      renderAll();
      $('importMsg').textContent = 'Histórico local apagado.';
    }
  };
}
async function init() {
  try {
    // Ouvir o evento de instalação antes de qualquer await: ele pode disparar cedo.
    let promptEvent;
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      promptEvent = e;
      $('install').hidden = false;
    });
    $('install').onclick = async () => {
      if (promptEvent) {
        promptEvent.prompt();
        await promptEvent.userChoice;
        promptEvent = null;
        $('install').hidden = true;
      } else alert('No iPhone/iPad: Safari > Compartilhar > Adicionar à Tela de Início.');
    };
    db = await openDB();
    draws = await dbGetAll();
    if (!localStorage.getItem(SAVED_KEY)) {
      const oldGames = safeJSON(localStorage.getItem('lc_saved_v1'), null);
      if (Array.isArray(oldGames)) localStorage.setItem(SAVED_KEY, JSON.stringify(oldGames));
    }
    fillModalities();
    updatePick();
    bind();
    renderAll(); // mostra imediatamente o que já está salvo neste dispositivo
    const setOnline = () => ($('connection').textContent = navigator.onLine ? 'Online' : 'Offline');
    setOnline();
    window.addEventListener('online', setOnline);
    window.addEventListener('offline', setOnline);
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost'))
      navigator.serviceWorker.register('./service-worker.js').catch(() => {});
    if (draws.length) idleMessage();
    else updateLatest(); // primeira visita: baixa a base completa uma única vez, sem bloquear o app
  } catch (e) {
    $('status').textContent = 'Falha ao iniciar armazenamento';
    $('substatus').textContent = e.message;
  }
}
init();
