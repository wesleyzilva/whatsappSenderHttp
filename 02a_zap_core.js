'use strict';
/**
 * 02a_zap_core.js — núcleo multi-zap (até 5 chips)
 *
 *  • Log de erros estruturado (JSON por linha) em 03_log/erros/
 *  • Classificação de erros (logout, bloqueio, rede, página travada, arquivo travado)
 *  • Detecção de internet (+ monitor em segundo plano)
 *  • Cadastro de chips (05_config/chips.json) e estado (05_config/chips_estado.json)
 *  • Identificação por número de telefone e rastreio da última execução (janela móvel de 24h)
 *  • Classe Zap: conecta, testa, reconecta, desconecta (sem derrubar o processo)
 */

const fs   = require('fs');
const os   = require('os');
const net  = require('net');
const { execFileSync } = require('child_process');
const path = require('path');

const DIR         = __dirname;
const LOG_DIR     = path.join(DIR, '03_log');
const ERR_DIR     = path.join(LOG_DIR, 'erros');
const CFG_DIR     = path.join(DIR, '05_config');
const CHIPS_FILE  = path.join(CFG_DIR, 'chips.json');
const ESTADO_FILE = path.join(CFG_DIR, 'chips_estado.json');
const ENVIOS_FILE = path.join(CFG_DIR, 'chips_envios.json');   // ledger: instante de cada envio, por zap
const AUTH_DIR    = path.join(DIR, '.wwebjs_auth');

const MAX_CHIPS         = 5;
const DEFAULT_CAP       = 50;                  // limite do zap por janela (o WhatsApp bloqueia ao passar disso)
const DEFAULT_MARGEM    = 2;                   // folga: o programa usa 50 − 2 = 48 por zap
const DEFAULT_JANELA_H  = 24;                  // janela móvel do limite (nunca menor que 24h)
const DEFAULT_LOTE_MIN  = 1;                   // envia assim que houver ao menos 1 vaga após as 24h
const DEFAULT_PAUSA_H   = 24;                  // pausa do zap quando o WhatsApp limita/bloqueia
// Horário de envio DESATIVADO por padrão ("ativo": false = envia a qualquer hora, respeitando apenas as 24h).
const DEFAULT_JANELAS   = [
  { dias: [1, 2, 3, 4, 5], inicio: '18:30', fim: '21:30' },
  { dias: [0, 6],          inicio: '09:00', fim: '20:00' },
];
const LEGACY_CHIP_ID    = 'dra-daiana-sender'; // sessão que já existia: vira o "Chip 1"
const PROTOCOL_TIMEOUT  = 90_000;              // puppeteer: página travada é detectada em 90s

// ── Utilitários ──────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pad2  = n => String(n).padStart(2, '0');

function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

/** Data local (YYYY-MM-DD). */
function diaLocal(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Timestamp legível local: DD/MM/YYYY HH:mm:ss */
function dataHoraLocal(d = new Date()) {
  const dt = d instanceof Date ? d : new Date(d);
  return `${pad2(dt.getDate())}/${pad2(dt.getMonth() + 1)}/${dt.getFullYear()} ${pad2(dt.getHours())}:${pad2(dt.getMinutes())}:${pad2(dt.getSeconds())}`;
}

function withTimeout(promise, ms, label = 'operacao') {
  let t;
  const limite = new Promise((_, rej) => {
    t = setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([Promise.resolve(promise), limite]).finally(() => clearTimeout(t));
}

function primeiraLinha(msg) { return String(msg || '').split('\n')[0].slice(0, 200); }

function limparDigitos(n) { return String(n || '').replace(/\D/g, ''); }

/** 5516991234567 → +55 16 99123-4567 */
function formatarNumero(n) {
  const d = limparDigitos(n);
  if (!d) return '';
  if (d.startsWith('55') && (d.length === 13 || d.length === 12)) {
    const ddd = d.slice(2, 4), resto = d.slice(4);
    return `+55 ${ddd} ${resto.slice(0, resto.length - 4)}-${resto.slice(-4)}`;
  }
  return `+${d}`;
}

/** "Chip 1", "chip3" → apelido genérico (não agrega informação quando o número já é conhecido). */
function apelidoGenerico(ap) { return /^chip\s*\d*$/i.test(String(ap || '').trim()); }

/**
 * Identificador principal do zap:
 *  - número conhecido  → "+55 16 99721-2966" (apelido só aparece se for um nome útil, ex.: "wes trabalho")
 *  - número desconhecido → "Chip 3 (vazio)" — slot ainda não configurado/conectado
 */
function identificadorZap( { id, apelido, numero } = {}) {
  const numFmt = formatarNumero(numero);
  const ap     = String(apelido || id || '').trim();
  if (!numFmt) return `${ap || 'Chip'} (vazio)`;
  const digAp  = limparDigitos(ap);
  const digNum = limparDigitos(numero);
  if (apelidoGenerico(ap) || !ap || (digAp && (digNum.endsWith(digAp) || digAp.endsWith(digNum)))) {
    return numFmt;
  }
  return `${numFmt} (${ap})`;
}

/** Contato do paciente aparece mascarado nos logs de erro (LGPD): 16****4567 */
function mascarar(n) {
  const d = limparDigitos(n);
  return d.length < 8 ? '****' : `${d.slice(0, d.startsWith('55') ? 4 : 2)}****${d.slice(-4)}`;
}

// ── Versão da biblioteca ─────────────────────────────────────────────────────
let _verLib;
function versaoLib() {
  if (_verLib !== undefined) return _verLib;
  try { _verLib = JSON.parse(fs.readFileSync(path.join(DIR, 'node_modules', 'whatsapp-web.js', 'package.json'), 'utf8')).version; }
  catch { _verLib = null; }
  return _verLib;
}

// ── Classificação de erros ───────────────────────────────────────────────────
// Inclui "reading 'Socket'" como logout/sessão corrompida para não ficar em loop infinito
const PADROES = [
  ['logout',    /LOGOUT|logged out|UNPAIRED|post_logout|SESSAO_EXPIRADA|QR_REQUESTED_AGAIN|reading 'Socket'|Cannot read properties of null \(reading 'Socket'\)/i],
  ['bloqueio',  /rate.?overlimit|rate.?limit|too many|\b429\b|forbidden|banned|account.*(block|restrict)/i],
  ['arquivo',   /EBUSY|EPERM|resource busy or locked/i],
  ['rede',      /ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ETIMEOUT|ENETUNREACH|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_NETWORK_CHANGED|ERR_CONNECTION|net::ERR|socket hang up|Sem internet/i],
  ['pagina',    /timed out|Execution context was destroyed|Target closed|Session closed|Protocol error|detached Frame|Navigating frame was detached|Browser has disconnected|Page crashed|Connection closed|Timeout:/i],
];

/** logout | bloqueio | arquivo | rede | pagina | outro */
function classificar(msg) {
  const s = String(msg || '');
  for (const [tipo, re] of PADROES) if (re.test(s)) return tipo;
  return 'outro';
}

// ── Monitor de internet ──────────────────────────────────────────────────────
const netState = { ok: true, desde: Date.now(), iniciado: false };

function checarInternet(timeoutMs = 5000) {
  return new Promise(resolve => {
    let fim = false;
    const fecha = v => { if (!fim) { fim = true; try { s.destroy(); } catch { /* */ } resolve(v); } };
    const s = net.connect({ host: 'web.whatsapp.com', port: 443 });
    s.setTimeout(timeoutMs, () => fecha(false));
    s.on('connect', () => fecha(true));
    s.on('error',   () => fecha(false));
  });
}

/** Aguarda a internet voltar (backoff 5s → 30s). Retorna false se estourar maxMs. */
async function esperarInternet({ motivo = '', maxMs = Infinity } = {}) {
  if (await checarInternet()) return true;
  const ini = Date.now();
  let espera = 5000;
  logEvento('sem_internet_inicio', { motivo });
  console.log(`\x1b[33m[${dataHoraLocal()}] 📡 Sem internet${motivo ? ` (${motivo})` : ''} — aguardando a conexão voltar…\x1b[0m`);
  while (Date.now() - ini < maxMs) {
    await sleep(espera);
    if (await checarInternet()) {
      const off = Math.round((Date.now() - ini) / 1000);
      logEvento('sem_internet_fim', { motivo, offline_s: off });
      console.log(`\x1b[32m[${dataHoraLocal()}] 📶 Internet voltou (ficou ${off}s fora).\x1b[0m`);
      return true;
    }
    espera = Math.min(espera * 2, 30_000);
  }
  logErro('sem_internet_desistiu', new Error(`Sem internet por mais de ${Math.round(maxMs / 1000)}s`), { motivo });
  return false;
}

/** Registra no log quando a internet cai/volta, mesmo fora dos envios. */
function iniciarMonitorInternet(intervaloMs = 15_000) {
  if (netState.iniciado) return;
  netState.iniciado = true;
  const tick = async () => {
    const ok = await checarInternet(4000);
    if (ok !== netState.ok) {
      logEvento(ok ? 'internet_voltou' : 'internet_caiu',
        ok ? { offline_s: Math.round((Date.now() - netState.desde) / 1000) } : {});
      netState.ok = ok;
      netState.desde = Date.now();
    }
  };
  const t = setInterval(tick, intervaloMs);
  t.unref();
  tick();
}

// ── Log estruturado ──────────────────────────────────────────────────────────
let RUN_ID = null;
function setRunId(id) { RUN_ID = id; }

function escreverJsonl(prefixo, obj) {
  try {
    ensureDir(ERR_DIR);
    fs.appendFileSync(path.join(ERR_DIR, `${prefixo}_${diaLocal()}.jsonl`), JSON.stringify(obj) + '\n', 'utf8');
  } catch { /* log nunca pode derrubar o envio */ }
}

function logEvento(evento, dados = {}) {
  escreverJsonl('eventos', { ts: new Date().toISOString(), evento, runId: RUN_ID, ...dados });
}

/** O WhatsApp Web minificado devolve erros como "r" ou "t": sem tradução o log fica inutilizável. */
function traduzirMensagem(msg) {
  const m = String(msg || '').trim();
  if (m.length > 3) return { mensagem: m, codigoBruto: null };
  return {
    mensagem: `Erro interno do WhatsApp Web (código "${m || '?'}") — provável incompatibilidade com a biblioteca; tente o menu [16] (atualizar biblioteca)`,
    codigoBruto: m,
  };
}

function logErro(evento, err, dados = {}) {
  const msg = err && err.message ? err.message : String(err);
  const trad = traduzirMensagem(msg);
  escreverJsonl('erros', {
    ts: new Date().toISOString(),
    evento,
    tipo: classificar(msg),
    mensagem: trad.mensagem.slice(0, 500),
    ...(trad.codigoBruto !== null ? { codigoBruto: trad.codigoBruto } : {}),
    erroNome: (err && err.name) || null,
    stack: String((err && err.stack) || '').split('\n').slice(0, 6).join('\n'),
    runId: RUN_ID,
    internet: netState.ok,
    memLivreMB: Math.round(os.freemem() / 1048576),
    rssMB: Math.round(process.memoryUsage().rss / 1048576),
    node: process.version,
    wwebjs: versaoLib(),
    ...dados,
  });
}

// ── Proteção global: nenhum erro solto derruba o programa ────────────────────
let _protegido = false;
const _ultAviso = {};
function instalarProtecaoGlobal() {
  if (_protegido) return;
  _protegido = true;
  const tratar = origem => erro => {
    const err = erro instanceof Error ? erro : new Error(String(erro));
    try { logErro(origem, err); } catch { /* */ }
    const tipo = classificar(err.message);
    const agora = Date.now();
    if (!_ultAviso[tipo] || agora - _ultAviso[tipo] > 5000) {
      _ultAviso[tipo] = agora;
      console.log(`\x1b[33m[${dataHoraLocal()}] ⚠️  Erro interno tratado (${tipo}): ${primeiraLinha(err.message)} — registrado em 03_log/erros\x1b[0m`);
    }
  };
  process.on('unhandledRejection', tratar('unhandledRejection'));
  process.on('uncaughtException',  tratar('uncaughtException'));
  process.on('exit', () => { for (const id of [..._travas]) liberarTrava(id); });
}

// ── Trava por zap: impede dois programas na mesma sessão ─────────────────────
const _travas = new Set();
const arqTrava = id => path.join(CFG_DIR, `trava_${id}.json`);
function pidVivo(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
function adquirirTrava(id, apelido) {
  ensureDir(CFG_DIR);
  try {
    const t = JSON.parse(fs.readFileSync(arqTrava(id), 'utf8'));
    const iniciouDepoisDoBoot = Date.parse(t.desde) > (Date.now() - os.uptime() * 1000) - 60_000;
    if (t && t.pid && t.pid !== process.pid && pidVivo(t.pid) && iniciouDepoisDoBoot) {
      throw new Error(`ZAP_EM_USO: "${apelido || id}" já está sendo usado por outro programa (PID ${t.pid}). Feche a outra janela do disparador. Se não houver outra, apague ${path.join('05_config', 'trava_' + id + '.json')}.`);
    }
  } catch (e) { if (String(e.message).startsWith('ZAP_EM_USO')) throw e; }
  fs.writeFileSync(arqTrava(id), JSON.stringify({ pid: process.pid, desde: new Date().toISOString() }));
  _travas.add(id);
}
function liberarTrava(id) {
  try {
    const t = JSON.parse(fs.readFileSync(arqTrava(id), 'utf8'));
    if (t.pid === process.pid) fs.unlinkSync(arqTrava(id));
  } catch { /* */ }
  _travas.delete(id);
}

// ── Chrome "órfão" ───────────────────────────────────────────────────────────
function matarChromesOrfaos(id) {
  if (process.platform !== 'win32') return 0;
  try {
    const alvo = `session-${id}`.replace(/'/g, "''");
    const script = `$n=0; Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine -like '*${alvo}*' } | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop; $n++ } catch {} }; Write-Output $n`;
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout: 20_000, windowsHide: true, encoding: 'utf8' });
    const n = parseInt(String(out).trim(), 10) || 0;
    if (n) logEvento('chrome_orfao_encerrado', { chip: id, processos: n });
    return n;
  } catch (e) { logErro('matar_chrome_orfao_falhou', e, { chip: id }); return 0; }
}

// ── Cadastro de chips ────────────────────────────────────────────────────────
function configPadrao() {
  return {
    limiteDiario: DEFAULT_CAP,            // limite do zap por janela móvel de janelaHoras
    margemSeguranca: DEFAULT_MARGEM,      // vagas que NUNCA são usadas (uso real = limiteDiario − margem)
    janelaHoras: DEFAULT_JANELA_H,
    loteMinimo: DEFAULT_LOTE_MIN,         // envia a partir de 1 vaga disponível após as 24h
    pausaBloqueioHoras: DEFAULT_PAUSA_H,
    horario: { ativo: false, livre24h: true, janelas: JSON.parse(JSON.stringify(DEFAULT_JANELAS)) },
    modoPadrao: 'sequencial',
    chips: [
      { id: LEGACY_CHIP_ID, apelido: 'Chip 1', ativo: true },
      { id: 'chip2',        apelido: 'Chip 2', ativo: true },
      { id: 'chip3',        apelido: 'Chip 3', ativo: true },
    ],
  };
}

function salvarConfig(cfg) {
  ensureDir(CFG_DIR);
  fs.writeFileSync(CHIPS_FILE, JSON.stringify(cfg, null, 2), 'utf8');
}

function lerConfig() {
  ensureDir(CFG_DIR);
  if (!fs.existsSync(CHIPS_FILE)) { const c = configPadrao(); salvarConfig(c); return c; }
  let cfg, bruto = null;
  try { bruto = JSON.parse(fs.readFileSync(CHIPS_FILE, 'utf8').replace(/^\uFEFF/, '')); cfg = JSON.parse(JSON.stringify(bruto)); }
  catch (e) { logErro('chips_json_invalido', e); cfg = configPadrao(); }

  const cap = Math.floor(Number(cfg.limiteDiario));
  cfg.limiteDiario = Number.isFinite(cap) && cap > 0 ? cap : DEFAULT_CAP;
  const margem = Math.floor(Number(cfg.margemSeguranca));
  cfg.margemSeguranca = Number.isFinite(margem) && margem >= 0 ? margem : DEFAULT_MARGEM;
  if (cfg.margemSeguranca >= cfg.limiteDiario) cfg.margemSeguranca = Math.max(0, cfg.limiteDiario - 1);
  const jan = Number(cfg.janelaHoras);
  cfg.janelaHoras = Number.isFinite(jan) ? Math.max(DEFAULT_JANELA_H, jan) : DEFAULT_JANELA_H;

  // Migração automática para envio a qualquer hora (aguardando apenas as 24h por chip)
  let migrouLivre24h = false;
  if (bruto && (!bruto.horario || !bruto.horario.livre24h)) {
    if (!cfg.horario || typeof cfg.horario !== 'object') cfg.horario = {};
    cfg.horario.ativo = false;
    cfg.horario.livre24h = true;
    cfg.loteMinimo = DEFAULT_LOTE_MIN;
    migrouLivre24h = true;
  }

  const lote = Math.floor(Number(cfg.loteMinimo));
  cfg.loteMinimo = Number.isFinite(lote) && lote > 0 ? lote : DEFAULT_LOTE_MIN;
  const pausa = Number(cfg.pausaBloqueioHoras);
  cfg.pausaBloqueioHoras = Number.isFinite(pausa) && pausa > 0 ? pausa : DEFAULT_PAUSA_H;
  cfg.horario = normalizarHorario(cfg.horario);
  cfg.modoPadrao = cfg.modoPadrao === 'paralelo' ? 'paralelo' : 'sequencial';
  cfg.chips = (Array.isArray(cfg.chips) ? cfg.chips : [])
    .filter(c => c && c.id)
    .slice(0, MAX_CHIPS)
    .map((c, i) => ({ id: String(c.id), apelido: c.apelido || `Chip ${i + 1}`, ativo: c.ativo !== false }));

  if (bruto && migrouLivre24h) {
    try {
      const novo = { ...bruto, loteMinimo: cfg.loteMinimo, horario: cfg.horario };
      fs.writeFileSync(CHIPS_FILE, JSON.stringify(novo, null, 2), 'utf8');
    } catch (e) { logErro('chips_json_nao_atualizado', e); }
  }
  return cfg;
}

/** "1", "Chip 2", "+55 16 99721-2966" ou o id → chip da config (ou null) */
function resolverChip(cfg, sel) {
  const s = String(sel || '').trim();
  if (!s) return null;
  if (/^\d+$/.test(s) && Number(s) >= 1 && Number(s) <= cfg.chips.length) {
    return cfg.chips[Number(s) - 1] || null;
  }
  const dig = limparDigitos(s);
  const est = lerEstado();
  return cfg.chips.find(c => {
    if (c.id === s || c.apelido.toLowerCase() === s.toLowerCase()) return true;
    const numEst = limparDigitos((est[c.id] || {}).numero);
    return dig.length >= 8 && numEst && (numEst.endsWith(dig) || dig.endsWith(numEst));
  }) || null;
}

function adicionarChip(cfg, apelido) {
  if (cfg.chips.length >= MAX_CHIPS) throw new Error(`Limite de ${MAX_CHIPS} zaps atingido`);
  const usados = new Set(cfg.chips.map(c => c.id));
  const id = [LEGACY_CHIP_ID, 'chip2', 'chip3', 'chip4', 'chip5'].find(x => !usados.has(x));
  const chip = { id, apelido: (apelido || '').trim() || `Chip ${cfg.chips.length + 1}`, ativo: true };
  cfg.chips.push(chip);
  salvarConfig(cfg);
  return chip;
}

function lerEstado() {
  try { return JSON.parse(fs.readFileSync(ESTADO_FILE, 'utf8')); } catch { return {}; }
}
function patchEstado(id, patch) {
  try {
    const e = lerEstado();
    e[id] = { ...(e[id] || {}), ...patch };
    ensureDir(CFG_DIR);
    fs.writeFileSync(ESTADO_FILE, JSON.stringify(e, null, 2), 'utf8');
  } catch (err) { logErro('estado_nao_salvo', err, { chip: id }); }
}

/**
 * Descobre o número de telefone de um chip olhando:
 * 1) chips_estado.json
 * 2) sent_log.json (campo "de")
 * 3) o próprio apelido se for um telefone (ex.: "16997212966")
 */
function obterNumeroChip(chip, estadoObj, sentLog) {
  const est = estadoObj || lerEstado();
  const st  = est[chip.id] || {};
  if (st.numero) return limparDigitos(st.numero);

  // Procura no sent_log pelo último número usado por este chip
  if (sentLog) {
    let melhorTs = 0, melhorNum = null;
    for (const e of Object.values(sentLog)) {
      if (!e || (e.chip || LEGACY_CHIP_ID) !== chip.id || !e.de) continue;
      const t = Date.parse(e.sentAt || '') || 0;
      if (t >= melhorTs) { melhorTs = t; melhorNum = limparDigitos(e.de); }
    }
    if (melhorNum) {
      patchEstado(chip.id, { numero: melhorNum });
      return melhorNum;
    }
  }

  // Se o apelido for um número de telefone (10 ou 11 dígitos com DDD, ou 12/13 com 55)
  const digApelido = limparDigitos(chip.apelido);
  if (digApelido.length >= 10 && digApelido.length <= 13) {
    return digApelido.startsWith('55') ? digApelido : `55${digApelido}`;
  }
  return null;
}

// ── Limite por janela móvel de 24h (por chip E por número de telefone) ───────
function limiteEfetivo(cfg) {
  return Math.max(1, cfg.limiteDiario - cfg.margemSeguranca);
}

function lerEnvios() {
  try {
    const j = JSON.parse(fs.readFileSync(ENVIOS_FILE, 'utf8'));
    return j && typeof j === 'object' && !Array.isArray(j) ? j : {};
  } catch { return {}; }
}

/** Anota um envio do zap (por ID e por número de telefone) na hora, em disco. */
function registrarEnvio(id, quando = Date.now(), numero = null) {
  try {
    const e = lerEnvios();
    const corte = Date.now() - 72 * 3_600_000;
    for (const k of Object.keys(e)) e[k] = (Array.isArray(e[k]) ? e[k] : []).filter(t => Number.isFinite(t) && t >= corte);
    (e[id] = e[id] || []).push(quando);
    const numLimpo = limparDigitos(numero);
    if (numLimpo) {
      const kNum = `tel_${numLimpo}`;
      (e[kNum] = e[kNum] || []).push(quando);
    }
    ensureDir(CFG_DIR);
    const tmp = `${ENVIOS_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(e), 'utf8');
    fs.renameSync(tmp, ENVIOS_FILE);
    patchEstado(id, { ultimoEnvio: new Date(quando).toISOString(), ...(numLimpo ? { numero: numLimpo } : {}) });
  } catch (err) { logErro('ledger_nao_salvo', err, { chip: id }); }
}

/**
 * Instantes (ms, crescentes) dos envios do zap/número dentro da janela de 24h.
 * Cruza tanto pelo ID do chip quanto pelo número do telefone para garantir que o mesmo número
 * nunca ultrapasse 48 envios em 24h.
 */
function timestampsJanela(id, sentLog, cfg, agora = Date.now(), numero = null) {
  const corte = agora - cfg.janelaHoras * 3_600_000;
  const envios = lerEnvios();
  const numLimpo = limparDigitos(numero || (lerEstado()[id] || {}).numero);

  const ledId  = (Array.isArray(envios[id]) ? envios[id] : []).filter(t => Number.isFinite(t) && t > corte);
  const ledNum = numLimpo && Array.isArray(envios[`tel_${numLimpo}`])
    ? envios[`tel_${numLimpo}`].filter(t => Number.isFinite(t) && t > corte)
    : [];
  const led = ledId.length >= ledNum.length ? ledId : ledNum;

  const log = [];
  for (const e of Object.values(sentLog || {})) {
    if (!e || e.status !== 'sent' || !e.sentAt) continue;
    const mesmoChip = (e.chip || LEGACY_CHIP_ID) === id;
    const mesmoNum  = numLimpo && e.de && limparDigitos(e.de) === numLimpo;
    if (!mesmoChip && !mesmoNum) continue;
    const t = Date.parse(e.sentAt);
    if (Number.isFinite(t) && t > corte) log.push(t);
  }
  return (led.length >= log.length ? led : log).sort((a, b) => a - b);
}

/**
 * Retorna o timestamp (ms) do ÚLTIMO envio feito por este chip/número (mesmo que há mais de 24h),
 * ou null se nunca enviou. Permite identificar exatamente a última execução.
 */
function ultimoEnvioChip(id, sentLog, numero = null) {
  const est = lerEstado()[id] || {};
  const numLimpo = limparDigitos(numero || est.numero);
  let maxTs = est.ultimoEnvio ? (Date.parse(est.ultimoEnvio) || 0) : 0;

  const envios = lerEnvios();
  for (const k of [id, numLimpo ? `tel_${numLimpo}` : null].filter(Boolean)) {
    const arr = envios[k];
    if (Array.isArray(arr) && arr.length) {
      const u = Math.max(...arr.filter(Number.isFinite));
      if (u > maxTs) maxTs = u;
    }
  }

  for (const e of Object.values(sentLog || {})) {
    if (!e || e.status !== 'sent' || !e.sentAt) continue;
    const mesmoChip = (e.chip || LEGACY_CHIP_ID) === id;
    const mesmoNum  = numLimpo && e.de && limparDigitos(e.de) === numLimpo;
    if (!mesmoChip && !mesmoNum) continue;
    const t = Date.parse(e.sentAt);
    if (Number.isFinite(t) && t > maxTs) maxTs = t;
  }

  return maxTs > 0 ? maxTs : null;
}

/** { idDoZap: envios na janela } para todos os zaps cadastrados. */
function enviadosJanelaPorChip(sentLog, cfg) {
  const r = {};
  const est = lerEstado();
  for (const c of cfg.chips) {
    const num = obterNumeroChip(c, est, sentLog);
    r[c.id] = timestampsJanela(c.id, sentLog, cfg, Date.now(), num).length;
  }
  return r;
}

function enviadosHojePorChip(sentLog, cfg) { return enviadosJanelaPorChip(sentLog, cfg || lerConfig()); }

/**
 * Instante (ms) a partir do qual o zap terá ao menos n vagas livres na janela de 24h.
 */
function quandoTemVagas(id, n, sentLog, cfg, agora = Date.now(), numero = null) {
  const ef = limiteEfetivo(cfg);
  n = Math.max(1, Math.min(n, ef));
  const ts = timestampsJanela(id, sentLog, cfg, agora, numero);
  const maxOcupado = ef - n;
  if (ts.length <= maxOcupado) return agora;
  const k = ts.length - maxOcupado;
  return ts[k - 1] + cfg.janelaHoras * 3_600_000 + 30_000;
}

// ── Horário permitido de envio (desativado por padrão = envia a qualquer hora) ─
const minutosDoDia = hhmm => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + m; };
const okHora = s => /^([01]?\d|2[0-3]):[0-5]\d$/.test(String(s || '').trim());
const NOMES_DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

function normalizarHorario(h) {
  h = h && typeof h === 'object' ? h : {};
  const ativo = h.ativo === true; // só ativa se explicitamente true
  let janelas = [];
  if (Array.isArray(h.janelas)) {
    for (const j of h.janelas) {
      if (!j || !okHora(j.inicio) || !okHora(j.fim)) continue;
      let dias = Array.isArray(j.dias) ? j.dias.map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6) : [];
      if (!dias.length) dias = [0, 1, 2, 3, 4, 5, 6];
      janelas.push({ dias: [...new Set(dias)].sort(), inicio: String(j.inicio).trim(), fim: String(j.fim).trim() });
    }
  }
  if (!janelas.length) janelas = JSON.parse(JSON.stringify(DEFAULT_JANELAS));
  return { ativo, livre24h: true, janelas };
}

function descreverHorario(cfg) {
  const h = cfg.horario;
  if (!h || !h.ativo) return 'livre (a qualquer hora — respeitando apenas a janela de 24h de cada número)';
  return h.janelas.map(j => {
    const d = j.dias;
    const cont = d.length > 2 && d.every((x, i) => i === 0 || x === d[i - 1] + 1);
    const dias = d.length === 7 ? 'todos os dias' : cont ? `${NOMES_DIAS[d[0]]}–${NOMES_DIAS[d[d.length - 1]]}` : d.map(x => NOMES_DIAS[x]).join(', ');
    return `${dias} ${j.inicio}–${j.fim}`;
  }).join(' · ');
}

function dentroDoHorario(cfg, quando = Date.now()) {
  const h = cfg.horario;
  if (!h || !h.ativo) return true;
  const d = new Date(quando);
  const m = d.getHours() * 60 + d.getMinutes();
  const dia = d.getDay(), diaAnt = (dia + 6) % 7;
  for (const j of h.janelas) {
    const ini = minutosDoDia(j.inicio), fim = minutosDoDia(j.fim);
    if (ini === fim) { if (j.dias.includes(dia)) return true; continue; }
    if (ini < fim) { if (j.dias.includes(dia) && m >= ini && m < fim) return true; }
    else if ((j.dias.includes(dia) && m >= ini) || (j.dias.includes(diaAnt) && m < fim)) return true;
  }
  return false;
}

function proximaAbertura(cfg, quando = Date.now()) {
  if (dentroDoHorario(cfg, quando)) return quando;
  let melhor = null;
  for (let off = 0; off <= 8; off++) {
    for (const j of cfg.horario.janelas) {
      const [hh, mm] = String(j.inicio).split(':').map(Number);
      const d = new Date(quando);
      d.setDate(d.getDate() + off);
      d.setHours(hh, mm, 0, 0);
      if (!j.dias.includes(d.getDay()) || d.getTime() <= quando) continue;
      if (melhor === null || d.getTime() < melhor) melhor = d.getTime();
    }
    if (melhor !== null) break;
  }
  return melhor !== null ? melhor : quando + 3_600_000;
}

// ── Sessões em disco ─────────────────────────────────────────────────────────
const dirSessao    = id => path.join(AUTH_DIR, `session-${id}`);
const sessaoExiste = id => fs.existsSync(dirSessao(id));

function removerSessao(id) {
  try {
    fs.rmSync(dirSessao(id), { recursive: true, force: true, maxRetries: 6, retryDelay: 1000 });
    return true;
  } catch (e) { logErro('remover_sessao_falhou', e, { chip: id }); return false; }
}

function criarAuth(clientId) {
  const { LocalAuth } = require('whatsapp-web.js');

  class SafeLocalAuth extends LocalAuth {
    async logout() {
      try {
        await super.logout();
      } catch (e) {
        logErro('limpeza_sessao_falhou', e, { chip: clientId, etapa: 'LocalAuth.logout' });
        try { await withTimeout(this.client && this.client.pupBrowser && this.client.pupBrowser.close(), 10_000, 'fechar browser'); } catch { /* */ }
        await sleep(2500);
        if (this.userDataDir) {
          try {
            fs.rmSync(this.userDataDir, { recursive: true, force: true, maxRetries: 6, retryDelay: 1000 });
            logEvento('sessao_removida_no_retry', { chip: clientId });
          } catch (e2) { logErro('limpeza_sessao_falhou_final', e2, { chip: clientId }); }
        }
      }
    }
  }
  return new SafeLocalAuth({ clientId, dataPath: AUTH_DIR });
}

// ── Zap (um chip / uma sessão do WhatsApp Web) ───────────────────────────────
class Zap {
  constructor(cfgChip, { chromePath } = {}) {
    this.id = cfgChip.id;
    this.apelido = cfgChip.apelido || cfgChip.id;
    this.chromePath = chromePath || undefined;
    this.client = null;
    this.pronto = false;
    this.numero = cfgChip.numero || (lerEstado()[this.id] || {}).numero || null;
    this.sessaoPerdida = false;
    this.motivoDesconexao = null;
    this.ultimoErro = null;
    this.bloqueado = false;
    this.quota = 0;
    this.motivoParada = null;
    this.travaAtiva = false;
    this.cancelado = false;
    this._abortar = null;
  }

  get rotulo() { return identificadorZap({ id: this.id, apelido: this.apelido, numero: this.numero }); }

  _criarClient() {
    const { Client } = require('whatsapp-web.js');
    return new Client({
      authStrategy: criarAuth(this.id),
      puppeteer: {
        headless: true,
        executablePath: this.chromePath,
        protocolTimeout: PROTOCOL_TIMEOUT,
        args: [
          '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
          '--no-first-run', '--no-zygote', '--disable-extensions', '--disable-background-networking',
        ],
      },
    });
  }

  async conectar({ permitirQR = true, readyTimeoutMs = 120_000, authTimeoutMs = null, qrTimeoutMs = 180_000,
                   limparTela = false, dicaCancelar = '' } = {}) {
    if (!(await esperarInternet({ motivo: `conectar ${this.rotulo}`, maxMs: 10 * 60_000 }))) {
      throw new Error('Sem internet há mais de 10 minutos');
    }
    adquirirTrava(this.id, this.rotulo);
    this.travaAtiva = true;
    matarChromesOrfaos(this.id);

    this.pronto = false;
    this.sessaoPerdida = false;
    this.motivoDesconexao = null;
    this.ultimoErro = null;
    this.cancelado = false;
    const posAuthMs = authTimeoutMs || (permitirQR ? 300_000 : readyTimeoutMs);

    const client = this._criarClient();
    this.client = client;
    logEvento('conectando', { chip: this.id, numero: this.numero, wwebjs: versaoLib() });

    try {
      await new Promise((resolve, reject) => {
        let timer, hb, poll, fechado = false, autenticado = false;
        const atual  = () => client === this.client;
        const parar  = () => { clearTimeout(timer); clearInterval(hb); clearInterval(poll); };
        const fim    = err => { if (fechado) return; fechado = true; parar(); err ? reject(err) : resolve(); };
        const armar  = (ms, msg) => { if (fechado) return; clearTimeout(timer); timer = setTimeout(() => fim(new Error(msg)), ms); };
        this._abortar = () => { this.cancelado = true; fim(new Error('CANCELADO: conexão cancelada pelo usuário')); };

        const marcarPronto = origem => {
          if (fechado || this.pronto || !atual()) return;
          this.pronto = true;
          const wid = client.info && client.info.wid;
          this.numero = (wid && wid.user) || this.numero;
          patchEstado(this.id, { numero: this.numero, ultimaConexao: new Date().toISOString(), precisaQR: false, ultimoErro: null });
          logEvento('conectado', { chip: this.id, numero: this.numero, origem });
          fim();
        };

        armar(readyTimeoutMs, `Timeout: ${this.rotulo} não ficou pronto em ${readyTimeoutMs / 1000}s (sessão expirada, WhatsApp Web lento ou pouca memória)`);

        client.on('qr', qr => {
          if (!atual()) return;
          if (this.pronto || fechado) {
            this.sessaoPerdida = true;
            this.motivoDesconexao = this.motivoDesconexao || 'QR_REQUESTED_AGAIN';
            patchEstado(this.id, { precisaQR: true });
            return;
          }
          patchEstado(this.id, { precisaQR: true });
          if (!permitirQR) { fim(new Error('SESSAO_EXPIRADA: este zap pede novo QR Code')); return; }
          if (limparTela && process.stdout.isTTY) process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
          console.log(`\n📱 [${this.rotulo}] Escaneie o QR Code com o WhatsApp do celular DESTE chip:\n`);
          require('qrcode-terminal').generate(qr, { small: true });
          console.log(`\n(aguardando autenticação — você tem ${qrTimeoutMs / 1000} segundos${dicaCancelar ? ' · ' + dicaCancelar : ''})\n`);
          armar(qrTimeoutMs, `Timeout: QR do ${this.rotulo} não foi escaneado em ${qrTimeoutMs / 1000}s`);
        });

        client.on('authenticated', () => {
          if (!atual() || fechado || autenticado) return;
          autenticado = true;
          console.log(`\x1b[32m[${dataHoraLocal()}] ✅ [${this.rotulo}] autenticado — carregando…\x1b[0m`);
          armar(posAuthMs, `Timeout: ${this.rotulo} autenticou mas o WhatsApp não ficou pronto em ${Math.round(posAuthMs / 1000)}s (evento "ready" não chegou)`);
          const t0 = Date.now();
          hb = setInterval(() => {
            if (fechado) return;
            console.log(`   ⏳ [${dataHoraLocal()}] [${this.rotulo}] sincronizando com o WhatsApp… ${Math.round((Date.now() - t0) / 1000)}s${dicaCancelar ? ' · ' + dicaCancelar : ''}`);
          }, 15_000);
          poll = setInterval(async () => {
            if (fechado || this.pronto || !atual()) return;
            try {
              if (client.info && client.info.wid && (await withTimeout(client.getState(), 8000, 'getState')) === 'CONNECTED') marcarPronto('polling');
            } catch { /* ainda não está pronto */ }
          }, 5000);
        });

        client.on('auth_failure', msg => {
          if (atual()) {
            patchEstado(this.id, { precisaQR: true, ultimoErro: `auth_failure: ${msg}` });
            fim(new Error(`auth_failure: ${msg}`));
          }
        });
        client.on('loading_screen', (pct, msg) => {
          if (!atual() || fechado) return;
          process.stdout.write(`\r   ⏳ [${dataHoraLocal()}] [${this.rotulo}] Carregando WhatsApp Web… ${String(pct).padStart(3)}% ${msg || ''}          `);
          if (pct >= 100) process.stdout.write('\n');
        });
        client.on('change_state', st => { if (atual()) logEvento('estado_mudou', { chip: this.id, numero: this.numero, estado: st }); });

        client.on('disconnected', reason => {
          if (!atual()) return;
          this.pronto = false;
          this.sessaoPerdida = true;
          this.motivoDesconexao = String(reason);
          logErro('desconectado', new Error(String(reason)), { chip: this.id, numero: this.numero });
          console.log(`\x1b[33m[${dataHoraLocal()}] ⚠️  [${this.rotulo}] Desconectado: ${reason}\x1b[0m`);
          if (classificar(String(reason)) === 'logout') patchEstado(this.id, { precisaQR: true, ultimoErro: `Desconectado: ${reason}` });
          fim(new Error(`Desconectado: ${reason}`));
        });

        client.on('ready', () => marcarPronto('evento_ready'));

        client.initialize().catch(e => fim(e));
      });
    } catch (e) {
      this.ultimoErro = primeiraLinha(e.message);
      if (classificar(e.message) === 'logout') {
        patchEstado(this.id, { precisaQR: true, ultimoErro: this.ultimoErro });
      }
      if (!this.cancelado) logErro('conexao_falhou', e, { chip: this.id, numero: this.numero });
      await this.fechar();
      throw e;
    }
  }

  cancelar() { if (this._abortar) this._abortar(); }

  async fechar() {
    this.pronto = false;
    const c = this.client;
    this.client = null;
    this._abortar = null;
    if (c) {
      try { await withTimeout(c.destroy(), 15_000, 'destroy'); }
      catch (e) {
        logErro('destroy_falhou', e, { chip: this.id });
        try { const p = c.pupBrowser && c.pupBrowser.process && c.pupBrowser.process(); if (p) p.kill('SIGKILL'); } catch { /* */ }
        matarChromesOrfaos(this.id);
      }
      await sleep(1500);
    }
    if (this.travaAtiva) { liberarTrava(this.id); this.travaAtiva = false; }
  }

  async reconectar() {
    logEvento('reconectando', { chip: this.id, numero: this.numero });
    await this.fechar();
    await this.conectar({ permitirQR: false, readyTimeoutMs: 120_000 });
  }

  async testar() {
    const r = { chip: this.id, numero: this.numero, estado: 'SEM_CLIENTE', latenciaMs: null, ok: false };
    if (!this.client || !this.pronto) return r;
    const t0 = Date.now();
    try {
      r.estado = await withTimeout(this.client.getState(), 20_000, 'getState');
      r.latenciaMs = Date.now() - t0;
      r.ok = r.estado === 'CONNECTED';
    } catch (e) {
      r.estado = 'ERRO';
      r.erro = primeiraLinha(e.message);
      logErro('teste_conexao_falhou', e, { chip: this.id, numero: this.numero });
    }
    return r;
  }

  async desconectarConta() {
    let desvinculou = false;
    try {
      if (this.client && this.pronto) {
        await withTimeout(this.client.logout(), 30_000, 'logout');
        desvinculou = true;
      }
    } catch (e) { logErro('logout_falhou', e, { chip: this.id, numero: this.numero }); }
    await this.fechar();
    const removida = removerSessao(this.id);
    patchEstado(this.id, { numero: null, precisaQR: false, bloqueadoAte: null, desconectadoEm: new Date().toISOString() });
    this.numero = null;
    return { desvinculou, sessaoRemovida: removida };
  }
}

module.exports = {
  Zap, MAX_CHIPS, DEFAULT_CAP, LEGACY_CHIP_ID, ERR_DIR, CFG_DIR,
  sleep, withTimeout, diaLocal, dataHoraLocal, primeiraLinha, formatarNumero, identificadorZap, obterNumeroChip, mascarar, traduzirMensagem,
  classificar, checarInternet, esperarInternet, iniciarMonitorInternet,
  setRunId, logEvento, logErro, instalarProtecaoGlobal, versaoLib,
  lerConfig, salvarConfig, resolverChip, adicionarChip, lerEstado, patchEstado,
  enviadosHojePorChip, enviadosJanelaPorChip, timestampsJanela, ultimoEnvioChip, limiteEfetivo, registrarEnvio, quandoTemVagas,
  dentroDoHorario, proximaAbertura, descreverHorario, sessaoExiste, removerSessao,
};