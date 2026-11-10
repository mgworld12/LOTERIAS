'use strict';
/* Loterias CAIXA — módulo de conferência e utilidades.
   Carregado ANTES do script.js; só define funções (usadas depois que o app inicia) e usa globais do script.js
   ($, CFG, MONTHS, pad, esc, allDraws, latestDraw, meta, safeJSON, SAVED_KEY, drawKey, download, fmtDate...).
   Conteúdo: faixas de acertos, conferência de bilhetes (digitação / QR), leitura de QR (câmera, foto, texto),
   compartilhamento, gráficos das estatísticas, diagnóstico da base e aparência. */

// ===================================================================== faixas de acertos
// Regras gerais de acertos de cada modalidade. Valores e resgate: App/Portal Loterias CAIXA.
const TIERS = {
  megasena: { 6: 'Sena', 5: 'Quina', 4: 'Quadra' },
  lotofacil: { 15: '15 acertos', 14: '14 acertos', 13: '13 acertos', 12: '12 acertos', 11: '11 acertos' },
  quina: { 5: 'Quina', 4: 'Quadra', 3: 'Terno', 2: 'Duque' },
  lotomania: {
    20: '20 acertos',
    19: '19 acertos',
    18: '18 acertos',
    17: '17 acertos',
    16: '16 acertos',
    0: 'Nenhum acerto',
  },
  duplasena: { 6: 'Sena', 5: 'Quina', 4: 'Quadra', 3: 'Terno' },
  diadesorte: { 7: '7 acertos', 6: '6 acertos', 5: '5 acertos', 4: '4 acertos' },
  timemania: { 7: '7 acertos', 6: '6 acertos', 5: '5 acertos', 4: '4 acertos', 3: '3 acertos' },
  supersete: { 7: '7 colunas', 6: '6 colunas', 5: '5 colunas', 4: '4 colunas', 3: '3 colunas' },
};
const MILIONARIA_TIERS = new Set(['6+2', '6+1', '5+2', '5+1', '4+2', '4+1', '3+2', '3+1', '2+2', '2+1']);
const norm = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

function tierOf(type, res) {
  if (type === 'maismilionaria') {
    const k = `${res.count}+${res.extra}`;
    return MILIONARIA_TIERS.has(k) ? `${res.count} números + ${res.extra} trevo(s)` : '';
  }
  const parts = [];
  const main = TIERS[type]?.[res.count];
  if (main) parts.push(main);
  if (type === 'duplasena' && res.second) {
    const t2 = TIERS.duplasena[res.second.count];
    if (t2) parts.push(`${t2} (2º sorteio)`);
  }
  if (type === 'diadesorte' && res.extra) parts.push('Mês de Sorte');
  if (type === 'timemania' && res.extra) parts.push('Time do Coração');
  return parts.join(' + ');
}

// ===================================================================== conferência de um jogo
function scoreGame(g, d) {
  const res = { hits: new Set(), count: 0, extra: 0, second: null, trevosHits: [] };
  if (g.type === 'supersete') {
    (g.columns || []).forEach((c, i) => {
      if ((Array.isArray(c) ? c : [c]).includes(d.numbers[i])) res.hits.add(i);
    });
    res.count = res.hits.size;
    return res;
  }
  const h1 = (g.numbers || []).filter((n) => d.numbers.includes(n));
  res.hits = new Set(h1);
  res.count = h1.length;
  if (g.type === 'duplasena' && d.secondNumbers?.length) {
    const h2 = g.numbers.filter((n) => d.secondNumbers.includes(n));
    res.second = { count: h2.length, hits: new Set(h2) };
  }
  if (g.type === 'maismilionaria') {
    res.trevosHits = (g.trevos || []).filter((n) => (d.trevos || []).includes(n));
    res.extra = res.trevosHits.length;
  }
  if (g.type === 'diadesorte' && g.month) res.extra = g.month === d.month ? 1 : 0;
  if (g.type === 'timemania' && g.team) res.extra = norm(g.team) === norm(d.team) ? 1 : 0;
  return res;
}
// Resultado de um jogo salvo contra o último concurso da sua modalidade.
function lastScore(g) {
  const d = latestDraw(g.type);
  return d ? { d, res: scoreGame(g, d) } : null;
}
const isHit = (g, res, n, col) =>
  g.type === 'supersete' ? res.hits.has(col) : res.hits.has(n) || Boolean(res.second?.hits.has(n));

function ballsMarkup(g, res) {
  if (g.type === 'supersete')
    return g.columns
      .map(
        (c, j) =>
          `<span class="ball${res && res.hits.has(j) ? ' hit' : ''}" title="Coluna ${j + 1}">${(Array.isArray(c) ? c : [c]).join(',')}<small style="font-size:8px">${j + 1}</small></span>`,
      )
      .join('');
  return g.numbers.map((n) => `<span class="ball${res && isHit(g, res, n) ? ' hit' : ''}">${pad(n)}</span>`).join('');
}
function extrasText(g) {
  let e = '';
  if (g.month) e += ` · Mês: ${MONTHS[g.month - 1]}`;
  if (g.team) e += ` · Time: ${esc(g.team)}`;
  if (g.trevos) e += ` · Trevos: ${g.trevos.map(pad).join(' e ')}`;
  return e;
}
function summaryText(g, res) {
  let s = `${res.count} acerto${res.count === 1 ? '' : 's'}`;
  if (g.type === 'supersete') s = `${res.count} coluna${res.count === 1 ? '' : 's'} certa${res.count === 1 ? '' : 's'}`;
  if (res.second) s += ` no 1º sorteio · ${res.second.count} no 2º`;
  if (g.type === 'maismilionaria') s += ` + ${res.extra} trevo${res.extra === 1 ? '' : 's'}`;
  if (g.type === 'diadesorte' && g.month) s += res.extra ? ' · mês da sorte certo' : ' · mês da sorte errado';
  if (g.type === 'timemania' && g.team) s += res.extra ? ' · time do coração certo' : ' · time do coração errado';
  return s;
}
function drawLine(d) {
  const nums = d.type === 'supersete' ? d.numbers.join(' · ') : d.numbers.map(pad).join(' ');
  let s = `Sorteio: ${nums}`;
  if (d.secondNumbers?.length) s += ` | 2º sorteio: ${d.secondNumbers.map(pad).join(' ')}`;
  if (d.trevos?.length) s += ` | Trevos: ${d.trevos.join(' e ')}`;
  if (d.month) s += ` | Mês: ${MONTHS[d.month - 1]}`;
  if (d.team) s += ` | Time: ${esc(d.team)}`;
  return s;
}
function resultCard(g, d, i) {
  const res = scoreGame(g, d),
    tier = tierOf(g.type, res);
  return `<article class="game res-card${tier ? ' win' : ''}" data-type="${g.type}"><div class="gamehead"><span>${CFG[g.type].label} · Jogo ${i + 1}</span><span>Concurso ${d.contest} · ${fmtDate(d.date)}</span></div><div class="balls">${ballsMarkup(g, res)}</div><p class="res-sum"><b>${summaryText(g, res)}</b>${extrasText(g)}</p><p class="res-tier">${tier ? `🎉 Possível premiação: <b>${esc(tier)}</b>` : 'Sem faixa de premiação neste concurso.'}</p><small class="meta">${drawLine(d)}</small></article>`;
}
const CHECK_NOTE =
  '<p class="hint">A indicação de faixa segue as regras gerais de acertos. Valores e resgate: App ou Portal Loterias CAIXA. O comprovante da lotérica é o único documento que habilita o recebimento de prêmios.</p>';

// ===================================================================== digitação dos jogos
function parseLines(type, text) {
  const cfg = CFG[type],
    lo = cfg.zero ? 0 : 1,
    games = [],
    errors = [];
  String(text || '')
    .split(/\n|;/)
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((ln, i) => {
      const tag = `Jogo ${i + 1}`;
      if (type === 'supersete') {
        const digits = ln.match(/\d/g) || [];
        if (digits.length !== 7) return errors.push(`${tag}: informe 7 dígitos, um por coluna (ex.: 1 5 9 0 3 2 8).`);
        return games.push({ type, numbers: [], columns: digits.map((x) => [Number(x)]) });
      }
      let tokens = ln.match(/\d+/g) || [];
      if (tokens.length === 1 && tokens[0].length % 2 === 0 && tokens[0].length >= 2 * cfg.min)
        tokens = tokens[0].match(/\d{2}/g); // "010203040506" → 01 02 03 04 05 06
      const nums = tokens.map(Number);
      if (new Set(nums).size !== nums.length) return errors.push(`${tag}: há números repetidos.`);
      if (nums.some((n) => n < lo || n > cfg.max))
        return errors.push(`${tag}: use números de ${pad(lo)} a ${pad(cfg.max)}.`);
      if (nums.length < cfg.min || nums.length > cfg.maxPick)
        return errors.push(
          `${tag}: ${CFG[type].label} aceita de ${cfg.min} a ${cfg.maxPick} números (você informou ${nums.length}).`,
        );
      games.push({ type, numbers: nums.sort((a, b) => a - b) });
    });
  return { games, errors };
}
function readExtras(type) {
  const ex = {};
  if (type === 'diadesorte' && $('chkMonth').value) ex.month = Number($('chkMonth').value);
  if (type === 'timemania' && $('chkTeam').value.trim()) ex.team = $('chkTeam').value.trim();
  if (type === 'maismilionaria') {
    const t = parseNums($('chkTrevos').value).filter((n) => n >= 1 && n <= 6);
    if (t.length === 2) ex.trevos = t;
  }
  return ex;
}
function findDraw(type, contestText) {
  const c = Number(String(contestText || '').replace(/\D/g, ''));
  if (!c) return { d: latestDraw(type), auto: true };
  return { d: allDraws(type).find((x) => x.contest === c) || null, auto: false, c };
}

// ===================================================================== tela "Conferir bilhete"
function checkMsg(html, kind = '') {
  $('chkOut').innerHTML = `<div class="notice${kind ? ' ' + kind : ''}">${html}</div>`;
}
function runCheck() {
  const type = $('chkType').value,
    { games, errors } = parseLines(type, $('chkNums').value);
  if (errors.length) return checkMsg(errors.map(esc).join('<br>'), 'help');
  if (!games.length) return checkMsg('Digite as dezenas do bilhete (um jogo por linha) ou leia o QR Code.', 'help');
  const { d, auto, c } = findDraw(type, $('chkContest').value);
  if (!d)
    return checkMsg(
      auto
        ? `Ainda não há resultados de ${CFG[type].label} neste dispositivo. Clique em <b>Atualizar resultados</b> na tela inicial.`
        : `O concurso ${c} de ${CFG[type].label} não está na base deste dispositivo. Ele pode ser muito antigo, ou ainda não ter sido baixado: clique em <b>Atualizar resultados</b>. Se for um concurso futuro, aguarde o sorteio.`,
      'help',
    );
  const ex = readExtras(type);
  $('chkOut').innerHTML =
    `<h3>${CFG[type].label} — concurso ${d.contest} (${fmtDate(d.date)})${auto ? ' · último disponível' : ''}</h3><div class="cards">${games.map((g, i) => resultCard({ ...g, ...ex }, d, i)).join('')}</div>${CHECK_NOTE}`;
}
function runCheckSaved() {
  const saved = safeJSON(localStorage.getItem(SAVED_KEY), []);
  if (!saved.length)
    return checkMsg('Você ainda não salvou jogos. Gere jogos no Gerador e clique em Salvar jogos.', 'help');
  const cards = [],
    missing = new Set();
  saved.forEach((g, i) => {
    const d = latestDraw(g.type);
    if (d) cards.push(resultCard(g, d, i));
    else missing.add(CFG[g.type].label);
  });
  $('chkOut').innerHTML =
    `<h3>Meus jogos salvos × último concurso de cada modalidade</h3>${missing.size ? `<p class="hint">Sem resultados baixados para: ${[...missing].join(', ')}.</p>` : ''}<div class="cards">${cards.join('')}</div>${CHECK_NOTE}`;
}
function syncCheckFields() {
  const t = $('chkType').value;
  $('chkMonthField').hidden = t !== 'diadesorte';
  $('chkTeamField').hidden = t !== 'timemania';
  $('chkTrevosField').hidden = t !== 'maismilionaria';
  $('chkNums').placeholder =
    t === 'supersete'
      ? 'Um jogo por linha: 7 dígitos, um por coluna\nEx.: 1 5 9 0 3 2 8'
      : `Um jogo por linha\nEx.: ${Array.from({ length: Math.min(CFG[t].min, 6) }, (_, i) => pad(i * 7 + 3 + (CFG[t].zero ? 0 : 0))).join(' ')}`;
  renderCheck();
}
function renderCheck() {
  const el = $('chkLatest');
  if (!el) return;
  const t = $('chkType').value,
    d = latestDraw(t);
  el.textContent = d
    ? `Último concurso na base: nº ${d.contest} (${fmtDate(d.date)}). Deixe o campo "Concurso" vazio para usar o último.`
    : 'Sem resultados desta modalidade neste dispositivo ainda.';
}

// ===================================================================== leitura do QR Code
const QR_TYPES = [
  ['maismilionaria|\\+milionaria|mais milionaria|mais-milionaria', 'maismilionaria'],
  ['megasena|mega sena|mega-sena|mega_sena', 'megasena'],
  ['lotofacil|loto facil|loto-facil', 'lotofacil'],
  ['lotomania|loto mania', 'lotomania'],
  ['duplasena|dupla sena|dupla-sena', 'duplasena'],
  ['diadesorte|dia de sorte|dia-de-sorte', 'diadesorte'],
  ['timemania|time mania', 'timemania'],
  ['supersete|super sete|super-sete', 'supersete'],
  ['quina', 'quina'],
];
// Interpreta o texto de um QR de bilhete. O formato do QR da CAIXA não é documentado publicamente: a leitura
// procura, de forma tolerante, modalidade, concurso e dezenas (URL com parâmetros, JSON, "chave=valor" ou texto).
function parseTicketQR(raw) {
  const text = String(raw || '').trim(),
    kv = {},
    out = { raw: text, type: '', contest: '', lines: [], month: '', team: '', trevos: '' };
  try {
    new URL(text).searchParams.forEach((v, k) => (kv[k.toLowerCase()] = v));
  } catch {}
  try {
    const j = JSON.parse(text);
    if (j && typeof j === 'object')
      (function walk(o, p = '') {
        Object.entries(o).forEach(([k, v]) =>
          v && typeof v === 'object' && !Array.isArray(v)
            ? walk(v)
            : (kv[(p + k).toLowerCase()] = Array.isArray(v) ? v.join(' ') : String(v)),
        );
      })(j);
  } catch {}
  text.split(/[;&|\n]/).forEach((part) => {
    const m = part.match(/^\s*([\w\- ]{2,24}?)\s*[:=]\s*(.+)$/);
    if (m && !/^https?$/i.test(m[1])) kv[m[1].trim().toLowerCase()] = m[2].trim();
  });
  const pick = (...keys) => keys.map((k) => kv[k]).find(Boolean) || '';
  const hay = norm(pick('modalidade', 'loteria', 'jogo', 'tipo') || text);
  for (const [re, t] of QR_TYPES)
    if (new RegExp(re).test(hay)) {
      out.type = t;
      break;
    }
  out.contest = (
    pick('concurso', 'numeroconcurso', 'nconcurso', 'numconcurso') ||
    (text.match(/concurso\D{0,3}(\d{1,5})/i) || [])[1] ||
    ''
  ).replace(/\D/g, '');
  out.month = pick('mes', 'messorte', 'mesdesorte');
  out.team = pick('time', 'timecoracao', 'timedocoracao');
  out.trevos = pick('trevos', 'trevo');
  const explicit = pick('dezenas', 'numeros', 'numerosapostados', 'apostas', 'aposta', 'n', 'd');
  const sources = explicit ? [explicit] : [text];
  const min = out.type ? CFG[out.type].min : 5;
  sources.forEach((src) => {
    String(src)
      .split(/[\n|]/)
      .forEach((chunk) => {
        // sequência de números de 1–2 dígitos separados por espaço, vírgula, ponto-e-vírgula ou hífen
        const runs = chunk.match(/(?<!\d)\d{1,2}(?:[ ,;-]+\d{1,2}(?!\d))+/g) || [];
        runs.forEach((r) => {
          const n = r.match(/\d+/g);
          if (n.length >= min && n.length <= 50 && !out.lines.includes(n.join(' '))) out.lines.push(n.join(' '));
        });
      });
  });
  return out;
}
let camStream = null,
  camTimer = null;
const qrMsg = (s, bad = false) => {
  $('qrMsg').textContent = s;
  $('qrMsg').classList.toggle('bad', bad);
};
function handleQrText(raw) {
  const p = parseTicketQR(raw);
  $('qrRaw').textContent = p.raw;
  $('qrRawBox').hidden = false;
  $('qrText').value = p.raw;
  if (p.type) {
    $('chkType').value = p.type;
    syncCheckFields();
  }
  if (p.contest) $('chkContest').value = p.contest;
  const m = Number(String(p.month).replace(/\D/g, '')) || MONTHS.findIndex((x) => norm(x) === norm(p.month)) + 1;
  if (m >= 1 && m <= 12) $('chkMonth').value = String(m);
  if (p.team) $('chkTeam').value = p.team;
  if (p.trevos) $('chkTrevos').value = p.trevos;
  if (p.lines.length) {
    $('chkNums').value = p.lines.join('\n');
    qrMsg(
      `QR lido: ${p.lines.length} jogo(s) identificado(s)${p.type ? ' em ' + CFG[p.type].label : ' (escolha a modalidade)'}${p.contest ? `, concurso ${p.contest}` : ''}. Confira os dados e clique em Conferir.`,
    );
  } else
    qrMsg(
      'QR lido, mas não consegui extrair as dezenas: o conteúdo parece ser um código interno da CAIXA. Digite as dezenas do bilhete abaixo ou use o app Loterias CAIXA → Conferir bilhetes. (O conteúdo lido está disponível abaixo.)',
      true,
    );
}
function loadJsQR() {
  if (window.jsQR) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'vendor/jsQR.js?v=3.0.0';
    s.onload = resolve;
    s.onerror = () => reject(Error('Não foi possível carregar o leitor de QR.'));
    document.head.appendChild(s);
  });
}
const canDetect = () => 'BarcodeDetector' in window;
async function stopCamera() {
  clearTimeout(camTimer);
  if (camStream) camStream.getTracks().forEach((t) => t.stop());
  camStream = null;
  const box = $('qrCam');
  if (box) box.hidden = true;
  if ($('qrVideo')) $('qrVideo').srcObject = null;
  if ($('qrStart')) $('qrStart').disabled = false;
}
async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia)
    return qrMsg('Câmera indisponível neste navegador. Use "Enviar foto do QR" ou cole o conteúdo.', true);
  try {
    camStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
      audio: false,
    });
  } catch (e) {
    return qrMsg(
      `Não foi possível abrir a câmera (${e.name}). Permita o acesso à câmera ou use "Enviar foto do QR".`,
      true,
    );
  }
  const v = $('qrVideo');
  v.srcObject = camStream;
  await v.play().catch(() => {});
  $('qrCam').hidden = false;
  $('qrStart').disabled = true;
  qrMsg('Aponte a câmera para o QR Code do bilhete…');
  let detector = null;
  if (canDetect())
    try {
      detector = new BarcodeDetector({ formats: ['qr_code'] });
    } catch {}
  if (!detector) await loadJsQR().catch((e) => qrMsg(e.message, true));
  const canvas = document.createElement('canvas'),
    ctx = canvas.getContext('2d', { willReadFrequently: true });
  const loop = async () => {
    if (!camStream) return;
    try {
      let text = '';
      if (v.readyState >= 2 && v.videoWidth) {
        if (detector) text = (await detector.detect(v))[0]?.rawValue || '';
        else if (window.jsQR) {
          const w = Math.min(720, v.videoWidth),
            h = Math.round((v.videoHeight * w) / v.videoWidth);
          canvas.width = w;
          canvas.height = h;
          ctx.drawImage(v, 0, 0, w, h);
          text = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' })?.data || '';
        }
      }
      if (text) {
        await stopCamera();
        return handleQrText(text);
      }
    } catch {}
    camTimer = setTimeout(loop, 150);
  };
  loop();
}
async function decodeImageFile(file) {
  const bmp = await createImageBitmap(file);
  if (canDetect())
    try {
      const r = await new BarcodeDetector({ formats: ['qr_code'] }).detect(bmp);
      if (r[0]?.rawValue) return r[0].rawValue;
    } catch {}
  await loadJsQR();
  const canvas = document.createElement('canvas'),
    ctx = canvas.getContext('2d', { willReadFrequently: true });
  for (const max of [1000, 1600, 600, 2200]) {
    const s = Math.min(1, max / Math.max(bmp.width, bmp.height)),
      w = Math.round(bmp.width * s),
      h = Math.round(bmp.height * s);
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(bmp, 0, 0, w, h);
    const r = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'attemptBoth' });
    if (r?.data) return r.data;
  }
  return '';
}

// ===================================================================== compartilhar jogos
function shareText(g) {
  const nums =
    g.type === 'supersete'
      ? g.columns.map((c) => (Array.isArray(c) ? c.join('/') : c)).join(' - ')
      : g.numbers.map(pad).join(' ');
  let t = `${CFG[g.type].label}: ${nums}`;
  if (g.month) t += ` | Mês: ${MONTHS[g.month - 1]}`;
  if (g.team) t += ` | Time: ${g.team}`;
  if (g.trevos) t += ` | Trevos: ${g.trevos.map(pad).join(' e ')}`;
  return t;
}
function shareButtons(g) {
  const t = esc(shareText(g));
  return `<span class="share"><button type="button" class="mini" data-copy="${t}" title="Copiar jogo">Copiar</button><button type="button" class="mini" data-wa="${t}" title="Enviar por WhatsApp">WhatsApp</button></span>`;
}
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

// ===================================================================== gráficos das estatísticas
function barChart(title, items, { avg = null, unit = '' } = {}) {
  const bw = 14,
    gap = 5,
    W = items.length * (bw + gap) + 34,
    H = 160,
    base = 124,
    top = 18,
    max = Math.max(1, ...items.map((i) => i.value)),
    sorted = [...items].sort((a, b) => b.value - a.value),
    hot = new Set(sorted.slice(0, 3).map((i) => i.label));
  const bars = items
    .map((it, k) => {
      const h = Math.max(1, ((base - top) * it.value) / max),
        x = 30 + k * (bw + gap);
      return `<g><title>${it.label}: ${it.value}${unit}</title><rect class="chart-bar${hot.has(it.label) ? ' hot' : ''}" x="${x}" y="${base - h}" width="${bw}" height="${h}" rx="2"/><text x="${x + bw / 2}" y="${base + 12}" text-anchor="middle" class="chart-lbl">${it.label}</text></g>`;
    })
    .join('');
  const avgLine =
    avg == null
      ? ''
      : `<line class="chart-avg" x1="28" x2="${W}" y1="${base - ((base - top) * avg) / max}" y2="${base - ((base - top) * avg) / max}"/><text x="2" y="${base - ((base - top) * avg) / max + 3}" class="chart-lbl">méd.</text>`;
  return `<figure class="chart"><figcaption>${title}</figcaption><div class="chart-scroll"><svg viewBox="0 0 ${W} ${H}" width="${Math.max(W, 320)}" height="${H}" role="img" aria-label="${esc(title)}"><text x="2" y="12" class="chart-lbl">${max}${unit}</text><line class="chart-axis" x1="28" x2="${W}" y1="${base}" y2="${base}"/>${avgLine}${bars}</svg></div></figure>`;
}
function renderStatsCharts(t, a, freq, delay, totalSlots) {
  const el = $('statsCharts');
  if (!el) return;
  if (!a.length) {
    el.innerHTML = '';
    return;
  }
  const cfg = CFG[t],
    nums = Array.from(
      { length: cfg.max + (cfg.zero || cfg.digit ? 1 : 0) },
      (_, i) => i + (cfg.zero || cfg.digit ? 0 : 1),
    ),
    avg = totalSlots ? totalSlots / nums.length : null;
  el.dataset.type = t;
  el.innerHTML =
    barChart(
      'Frequência de cada dezena no período',
      nums.map((n) => ({ label: pad(n), value: freq[n] || 0 })),
      { avg },
    ) +
    barChart(
      'Atraso atual de cada dezena (concursos sem sair)',
      nums.map((n) => ({ label: pad(n), value: delay[n] || 0 })),
      {},
    );
}

// ===================================================================== diagnóstico da base
function renderDiagnostics() {
  const el = $('diag');
  if (!el) return;
  const m = meta(),
    mods = m.publishedModalities || {},
    rows = Object.keys(CFG)
      .map((t) => {
        const local = allDraws(t),
          last = local[local.length - 1],
          p = mods[t] || {},
          nx =
            p.next && p.next.date >= new Date().toISOString().slice(0, 10)
              ? `nº ${p.next.contest} · ${fmtDate(p.next.date)}`
              : '—';
        return `<tr data-type="${t}"><th scope="row">${CFG[t].label}</th><td data-label="Neste dispositivo">${local.length.toLocaleString('pt-BR')}</td><td data-label="Publicado">${p.count != null ? p.count.toLocaleString('pt-BR') : '—'}</td><td data-label="Faltam">${p.missing ? p.missing.toLocaleString('pt-BR') : p.count != null ? '0' : '—'}</td><td data-label="Incompletos">${p.incomplete || 0}</td><td data-label="Último">${last ? `nº ${last.contest} · ${fmtDate(last.date)}` : '—'}</td><td data-label="Próximo sorteio">${nx}</td></tr>`;
      })
      .join(''),
    totalMissing = Object.values(mods).reduce((s, x) => s + (x.missing || 0), 0),
    errs = (m.publishedErrors || []).map((e) => `<li>${esc(e)}</li>`).join('');
  el.innerHTML = `<h3>Estado da base</h3><p class="hint">${
    !Object.keys(mods).length
      ? 'Ainda não há informações do servidor. Clique em Atualizar resultados.'
      : totalMissing
        ? `Histórico em carga no servidor: faltam ${totalMissing.toLocaleString('pt-BR')} concursos (os mais antigos). “Incompletos” são concursos sem algum campo extra (time, mês, trevos ou 2º sorteio): continuam valendo para as dezenas.`
        : 'Histórico completo no servidor.'
  }</p><div class="chart-scroll"><table class="diag-table"><thead><tr><th>Jogo</th><th>Neste dispositivo</th><th>Publicado</th><th>Faltam</th><th>Incompletos</th><th>Último</th><th>Próximo sorteio</th></tr></thead><tbody>${rows}</tbody></table></div>${errs ? `<details><summary>Avisos do servidor (${(m.publishedErrors || []).length})</summary><ul>${errs}</ul></details>` : ''}`;
}

// ===================================================================== aparência e jogos salvos
function applyTitleFont() {
  const f = localStorage.getItem('lc_titlefont') || 'fun';
  document.documentElement.dataset.titlefont = f;
  if ($('titleFont')) $('titleFont').value = f;
}
function exportSavedJson() {
  download(
    'jogos-salvos.json',
    JSON.stringify(
      {
        format: 'loterias-caixa-jogos-v1',
        created: new Date().toISOString(),
        saved: safeJSON(localStorage.getItem(SAVED_KEY), []),
      },
      null,
      2,
    ),
    'application/json',
  );
}
async function importSavedJson(file) {
  const j = JSON.parse(await file.text()),
    list = Array.isArray(j) ? j : j.saved;
  if (!Array.isArray(list)) throw Error('Arquivo inválido: não há lista de jogos.');
  const ok = list.filter((g) => g && CFG[g.type] && (Array.isArray(g.numbers) || Array.isArray(g.columns)));
  const cur = safeJSON(localStorage.getItem(SAVED_KEY), []),
    key = (g) => `${g.type}|${drawKey({ numbers: [], ...g })}`,
    seen = new Set(cur.map(key));
  let added = 0;
  ok.forEach((g) => {
    if (!seen.has(key(g))) {
      seen.add(key(g));
      cur.push(g);
      added++;
    }
  });
  localStorage.setItem(SAVED_KEY, JSON.stringify(cur));
  renderSaved();
  return `${added} jogo(s) importado(s); ${ok.length - added} já existiam; ${list.length - ok.length} ignorado(s) por formato inválido.`;
}

// ===================================================================== ligação com a página (chamada pelo bind())
function initCheck() {
  $('chkType').innerHTML = Object.keys(CFG)
    .map((t) => `<option value="${t}">${CFG[t].label}</option>`)
    .join('');
  $('chkMonth').innerHTML =
    '<option value="">—</option>' + MONTHS.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('');
  $('chkType').onchange = syncCheckFields;
  $('chkRun').onclick = runCheck;
  $('chkSavedRun').onclick = runCheckSaved;
  $('chkClear').onclick = () => {
    ['chkNums', 'chkContest', 'chkTeam', 'chkTrevos', 'qrText'].forEach((id) => ($(id).value = ''));
    $('chkMonth').value = '';
    $('chkOut').innerHTML = '';
    $('qrRawBox').hidden = true;
    qrMsg('');
  };
  $('qrStart').onclick = startCamera;
  $('qrStop').onclick = stopCamera;
  $('qrParse').onclick = () =>
    $('qrText').value.trim() ? handleQrText($('qrText').value) : qrMsg('Cole o conteúdo do QR Code no campo.', true);
  $('qrCopyRaw').onclick = () => copyText($('qrRaw').textContent);
  $('qrFile').onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    qrMsg('Lendo a imagem…');
    try {
      const text = await decodeImageFile(f);
      text
        ? handleQrText(text)
        : qrMsg(
            'Não encontrei um QR Code legível na foto. Aproxime, evite reflexos e tente de novo, ou digite os números.',
            true,
          );
    } catch (err) {
      qrMsg('Não foi possível ler a imagem: ' + err.message, true);
    }
  };
  // compartilhar (delegação: vale para jogos gerados e salvos)
  document.addEventListener('click', async (e) => {
    const c = e.target.closest('[data-copy]'),
      w = e.target.closest('[data-wa]');
    if (c) {
      await copyText(c.dataset.copy);
      const old = c.textContent;
      c.textContent = 'Copiado!';
      setTimeout(() => (c.textContent = old), 1400);
    } else if (w) window.open('https://wa.me/?text=' + encodeURIComponent(w.dataset.wa), '_blank', 'noopener');
  });
  // jogos salvos: JSON
  $('exportSavedJson').onclick = exportSavedJson;
  $('importSaved').onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      $('savedMsg').textContent = await importSavedJson(f);
    } catch (err) {
      $('savedMsg').textContent = 'Erro: ' + err.message;
    }
  };
  // aparência
  applyTitleFont();
  $('titleFont').onchange = () => {
    localStorage.setItem('lc_titlefont', $('titleFont').value);
    applyTitleFont();
  };
  syncCheckFields();
}
