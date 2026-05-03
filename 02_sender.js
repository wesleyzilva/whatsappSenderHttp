#!/usr/bin/env node
/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║   WhatsApp Bulk Sender · Dra. Daiana Ferraz              ║
 * ║   Responsável técnico: Wesley Silva                      ║
 * ╚══════════════════════════════════════════════════════════╝
 *
 * USO:
 *   node sender.js                        → usa a lista padrão e limita a 100 envios/dia (teto máximo seguro)
 *   node sender.js --dry-run              → simula sem enviar usando a lista padrão
 *   node sender.js <csv>                  → envia usando um CSV específico
 *   node sender.js <csv> --ddd=16            → envia apenas contatos com DDD 16
 *   node sender.js <csv> --ddd=16 --dry-run   → simula só DDD 16
 *   node sender.js <csv> --limit=10       → limita a N envios (respeitando o teto dinâmico)
 *   node sender.js <csv> --delay=5000     → delay entre envios em ms (padrão: 4000)
 *   node sender.js --status               → mostra resumo do log
 *   node sender.js --resumo               → relatório de situação (onde parei)
 *   node sender.js <csv> --resumo         → situação + progresso do CSV específico
 *   node sender.js --reset                → limpa todo o sent_log.json
 *   node sender.js --reset-run=<runId>    → remove entradas de uma execução
 *   node sender.js --no-human             → desativa cadência humana (delay fixo)
 */

'use strict';

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode  = require('qrcode-terminal');
const { parse } = require('csv-parse/sync');
const fs      = require('fs');
const path    = require('path');
const readline = require('readline');

// ── Configurações ─────────────────────────────────────────────────────────────
const DEFAULT_DELAY_MS   = 4000;   // delay base entre envios
const JITTER_MS          = 3000;   // jitter aleatório (evita padrão de bot)
const MAX_RETRIES        = 2;      // tentativas por mensagem em caso de erro
// Limite diário máximo: 100 envios/dia (todos os dias)
const DAILY_SEND_CAP = 100;

// Padrões de erro que indicam bloqueio/rate-limit do WhatsApp (interrompem o run)
const BLOCK_PATTERNS = [
  /rate.overlimit/i,
  /rate.limit/i,
  /too many/i,
  /429/,
  /forbidden/i,
  /banned/i,
  /account.*block/i,
  /session.*clos/i,
  /connection.*clos/i,
  /ETIMEOUT/,
  /ECONNRESET/,
];

// ── Cadência humana ──────────────────────────────────────────────────────────
// Simula tempo de leitura, pensamento e digitação entre cada mensagem.
// Desativar com --no-human para usar o delay fixo (DEFAULT_DELAY_MS).
const HUMAN = {
  readMin:      3_000,  // ms — abre o chat, verifica o contato
  readMax:      8_000,
  thinkMin:     4_000,  // ms — pausa antes de começar a digitar
  thinkMax:    15_000,
  typeSpeedMin:    15,  // chars/seg — velocidade de digitação mínima
  typeSpeedMax:    25,  // chars/seg — velocidade de digitação máxima
  typeClampMin:  5_000, // ms mínimo do indicador "digitando…"
  typeClampMax: 35_000, // ms máximo
  cooldownMin:   8_000, // ms — pausa após envio, antes do próximo contato
  cooldownMax:  25_000,
};

// Janelas de horário para envio (hora local do sistema).
// Fora delas o script pausa e aguarda automaticamente.
const SEND_WINDOWS = [
  { startH:  8, startM:  0, endH: 12, endM:  0 },  // 08:00 – 12:00
  { startH: 13, startM: 30, endH: 18, endM: 30 },  // 13:30 – 18:30
];

const DIR         = __dirname;
const LOG_DIR     = path.join(DIR, '03_log');
const SENT_LOG    = path.join(LOG_DIR, 'sent_log.json');
const DEFAULT_CSV = path.join(DIR, '02_disparos', 'lista_disparos_A_20260408.csv');

// ── Argumentos ───────────────────────────────────────────────────────────────
const args      = process.argv.slice(2);
const csvArg    = args.find(a => !a.startsWith('--'));
const csvPath   = csvArg ? path.resolve(DIR, csvArg) : DEFAULT_CSV;
const DRY_RUN   = args.includes('--dry-run');
const AUTO_YES  = args.includes('--yes');
const STATUS    = args.includes('--status');
const RESUMO    = args.includes('--resumo');
const RESET     = args.includes('--reset');
const RESET_RUN = (args.find(a => a.startsWith('--reset-run=')) || '').split('=')[1];
const EXPORT_BLACKLIST = args.includes('--export-blacklist');
const limitArg  = args.find(a => a.startsWith('--limit='));
const delayArg  = args.find(a => a.startsWith('--delay='));
const dddArg    = args.find(a => a.startsWith('--ddd='));
const DDD_FILTER = dddArg ? dddArg.split('=')[1].trim() : null;
const parsedLimit = limitArg ? parseInt(limitArg.split('=')[1], 10) : DAILY_SEND_CAP;
const LIMIT      = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : DAILY_SEND_CAP;
const DELAY_MS   = delayArg ? parseInt(delayArg.split('=')[1], 10) : DEFAULT_DELAY_MS;
const HUMAN_MODE = !args.includes('--no-human'); // cadência humana ativada por padrão

if (delayArg && HUMAN_MODE) {
  console.warn('\x1b[33m⚠️  --delay é ignorado no modo humano. Use --no-human para aplicar delay fixo.\x1b[0m');
}

// ── Utilitários ───────────────────────────────────────────────────────────────
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * Migra chaves legadas no formato  numero_categoria_YYYY-MM-DD
 * para o formato atual              numero_categoria_YYYYMM (passo intermediário)
 * depois migrado para                 numero_YYYYMM (sem categoria — dedup por número)
 */
function migrateLegacyLogKeys(log) {
  const LEGACY = /^(.+_[a-z_]+)_(\d{4})-(\d{2})-\d{2}$/;
  let changed = false;
  for (const oldKey of Object.keys(log)) {
    const m = oldKey.match(LEGACY);
    if (m) {
      const newKey = `${m[1]}_${m[2]}${m[3]}`;
      if (!log[newKey]) {
        log[newKey] = log[oldKey];
      }
      delete log[oldKey];
      changed = true;
    }
  }
  return changed;
}

/**
 * Migra chaves no formato numero_categoria_YYYYMM para numero_YYYYMM.
 * Garantia de não-duplicidade por número de telefone no mês.
 * Em caso de conflito (mesmo número, categorias diferentes), prioridade: sent > failed > outros.
 */
const STATUS_PRIORITY = { sent: 3, failed: 2, skipped_not_registered: 1, blocked_by_whatsapp: 0 };
function migrateToPhoneOnlyKeys(log) {
  const OLD_FORMAT = /^(\d+)_[a-z_]+_(\d{6})$/;  // numero_categoria_YYYYMM
  const merged = {}; // numero_YYYYMM -> melhor entrada
  const toDelete = [];
  for (const [key, entry] of Object.entries(log)) {
    const m = key.match(OLD_FORMAT);
    if (!m) continue; // já está no novo formato
    toDelete.push(key);
    const newKey = `${m[1]}_${m[2]}`;
    const existing = merged[newKey];
    const cur  = STATUS_PRIORITY[entry.status]  ?? -1;
    const prev = existing ? (STATUS_PRIORITY[existing.status] ?? -1) : -2;
    if (!existing || cur > prev) merged[newKey] = entry;
  }
  for (const k of toDelete) delete log[k];
  Object.assign(log, merged);
  return toDelete.length > 0;
}

function readSentLog() {
  ensureDir(LOG_DIR);
  if (!fs.existsSync(SENT_LOG)) return {};
  let log;
  try   { log = JSON.parse(fs.readFileSync(SENT_LOG, 'utf8')); }
  catch { return {}; }
  // 1º: migra YYYY-MM-DD → YYYYMM; 2º: migra numero_categoria_YYYYMM → numero_YYYYMM
  const c1 = migrateLegacyLogKeys(log);
  const c2 = migrateToPhoneOnlyKeys(log);
  if (c1 || c2) writeSentLog(log);
  return log;
}

function writeSentLog(log) {
  ensureDir(LOG_DIR);
  fs.writeFileSync(SENT_LOG, JSON.stringify(log, null, 2), 'utf8');
}

/**
 * Chave única: numero_YYYYMM
 * Um número só recebe mensagem UMA vez por mês, independentemente da categoria.
 */
function logKey(numero) {
  const ym = new Date().toISOString().slice(0, 7).replace('-', '');
  return `${String(numero).replace(/\D/g, '')}_${ym}`;
}

/** Formata número para o padrão WhatsApp (55 + DDD + número + @c.us) */
function formatPhone(numero) {
  let digits = String(numero).replace(/\D/g, '');
  if (!digits.startsWith('55')) digits = `55${digits}`;
  return `${digits}@c.us`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()); }));
}

function now() {
  return new Date().toISOString();
}

function banner(title) {
  const line = '═'.repeat(title.length + 4);
  console.log(`\n╔${line}╗`);
  console.log(`║  ${title}  ║`);
  console.log(`╚${line}╝\n`);
}

function colorize(text, code) {
  return `\x1b[${code}m${text}\x1b[0m`;
}
const green  = t => colorize(t, 32);
const red    = t => colorize(t, 31);
const yellow = t => colorize(t, 33);
const cyan   = t => colorize(t, 36);
const bold   = t => colorize(t, 1);

function randomBetween(min, max) { return min + Math.random() * (max - min); }
function clamp(val, min, max)    { return Math.min(Math.max(val, min), max); }

// ── Leitura e deduplicação do CSV ─────────────────────────────────────────────
function loadCSV(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Arquivo não encontrado: ${filePath}`);
  let raw = fs.readFileSync(filePath, 'utf8');

  // Remove BOM se houver
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);

  // Encontra a primeira linha que contenha o cabeçalho esperado
  // (ignora linhas de texto livre antes do CSV real)
  const lines = raw.split('\n');
  const headerIdx = lines.findIndex(l => l.trimStart().startsWith('pontuacao,'));
  if (headerIdx > 0) {
    raw = lines.slice(headerIdx).join('\n');
    console.log(yellow(`   ℹ️  ${headerIdx} linha(s) ignoradas antes do cabeçalho CSV\n`));
  }

  const records = parse(raw, {
    columns:          true,
    skip_empty_lines: true,
    relax_quotes:     true,
    trim:             true,
  });

  if (records.length === 0) throw new Error('CSV está vazio ou sem cabeçalho válido.');

  // Deduplicar: (numero, categoria) → manter maior pontuacao
  // Em caso de empate: primeiro encontrado
  const map = new Map();
  let duplicates = 0;
  for (const row of records) {
    if (!row.numero || !row.mensagem) continue; // pular linhas incompletas
    const key      = `${String(row.numero).replace(/\D/g, '')}_${row.categoria}`;
    const existing = map.get(key);
    if (!existing || Number(row.pontuacao) > Number(existing.pontuacao)) {
      if (existing) duplicates++;
      map.set(key, row);
    } else {
      duplicates++;
    }
  }

  return { records: [...map.values()], duplicates, total: records.length };
}

// ── Comando: --status ─────────────────────────────────────────────────────────
function pct(n, total) {
  if (!total) return '  0%';
  const p = Math.round(n / total * 100);
  return `${p.toString().padStart(3)}%`;
}
function bar(n, total, width = 20) {
  const filled = total ? Math.round(n / total * width) : 0;
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function showStatus() {
  banner('STATUS DO LOG DE ENVIOS');
  const log     = readSentLog();
  const entries = Object.values(log);
  if (entries.length === 0) {
    console.log(yellow('  Nenhum envio registrado ainda.\n'));
    return;
  }

  const total    = entries.length;
  const byCat    = {};
  const byStatus = {};
  const byDate   = {};
  const byRun    = {};

  for (const e of entries) {
    byCat[e.categoria]    = (byCat[e.categoria]    || 0) + 1;
    byStatus[e.status]    = (byStatus[e.status]    || 0) + 1;
    const day  = (e.sentAt || '').slice(0, 10);
    byDate[day]           = (byDate[day]            || 0) + 1;
    const rid  = e.runId  || 'desconhecido';
    if (!byRun[rid]) byRun[rid] = { sent: 0, failed: 0, skipped: 0, total: 0, date: day };
    byRun[rid].total++;
    if (e.status === 'sent')                    byRun[rid].sent++;
    else if (e.status === 'failed')             byRun[rid].failed++;
    else                                        byRun[rid].skipped++;
  }

  const sent    = byStatus['sent']                    || 0;
  const failed  = byStatus['failed']                  || 0;
  const skipped = byStatus['skipped_not_registered']  || 0;

  // ── Resumo geral ────────────────────────────────────────────────────────────
  console.log(bold('  Total de registros:'), total);
  console.log('');

  const barSent = bar(sent, total);
  console.log(bold('  Progresso geral:'));
  console.log(`  [${green(barSent)}] ${pct(sent, total)} enviados com sucesso`);
  console.log(`  Enviados   : ${green(sent.toString().padStart(4))}  ${pct(sent, total)}`);
  console.log(`  Nao-reg.   : ${yellow(skipped.toString().padStart(4))}  ${pct(skipped, total)}`);
  console.log(`  Falhas     : ${red(failed.toString().padStart(4))}  ${pct(failed, total)}`);
  console.log('');

  // ── Por status ──────────────────────────────────────────────────────────────
  console.log(bold('  Por status:'));
  for (const [s, n] of Object.entries(byStatus)) {
    const icon = s === 'sent' ? green('✅') : s === 'failed' ? red('❌') : yellow('⚠️ ');
    console.log(`    ${icon} ${s}: ${n}  (${pct(n, total)})`);
  }
  console.log('');

  // ── Por categoria ───────────────────────────────────────────────────────────
  console.log(bold('  Por categoria:'));
  for (const [c, n] of Object.entries(byCat).sort((a, b) => b[1] - a[1]))
    console.log(`    ${cyan(c.padEnd(30))}: ${n.toString().padStart(4)}  (${pct(n, total)})`);
  console.log('');

  // ── Por data ─────────────────────────────────────────────────────────────────
  console.log(bold('  Por data:'));
  const dateEntries = Object.entries(byDate).sort();
  let cumulative = 0;
  for (const [d, n] of dateEntries) {
    cumulative += n;
    const cPct = pct(cumulative, total);
    console.log(`    ${d}: ${n.toString().padStart(4)}  (${pct(n, total)} no dia)  acumulado: ${cumulative}/${total}  ${cPct}`);
  }
  console.log('');

  // ── Mapa runId → csvFile a partir dos arquivos run_*.json ────────────────────
  const runCsvMap = {};
  if (fs.existsSync(LOG_DIR)) {
    for (const f of fs.readdirSync(LOG_DIR).filter(f => f.startsWith('run_') && f.endsWith('.json'))) {
      try {
        const r = JSON.parse(fs.readFileSync(path.join(LOG_DIR, f), 'utf8'));
        if (r.runId && r.csvFile) runCsvMap[r.runId] = path.basename(r.csvFile);
      } catch { /* ignora corrompidos */ }
    }
  }

  // ── Por lote (runId) — adicionados / removidos ───────────────────────────────
  console.log(bold('  Por lote de envio (adicionados por execucao):'));
  const runEntries = Object.entries(byRun).sort((a, b) => a[0].localeCompare(b[0]));
  let runCum = 0;
  for (const [rid, r] of runEntries) {
    runCum += r.total;
    const csvLabel = runCsvMap[rid] ? cyan(runCsvMap[rid]) : yellow('(CSV desconhecido)');
    console.log(`    ${bold(rid.slice(0, 19))}  ${csvLabel}`);
    console.log(`      +${r.total.toString().padStart(3)} adicionados  ✅ ${r.sent}  ⚠️  ${r.skipped}  ❌ ${r.failed}  |  acumulado: ${runCum}/${total}  (${pct(runCum, total)})`);
  }
  console.log('');
}

// ── Comando: --resumo ─────────────────────────────────────────────────────────
function showResumo(csvPath) {
  banner('RELATÓRIO DE SITUAÇÃO DA CAMPANHA');

  // ── Últimas execuções ───────────────────────────────────────────────────────
  const runFiles = fs.existsSync(LOG_DIR)
    ? fs.readdirSync(LOG_DIR).filter(f => f.startsWith('run_') && f.endsWith('.json')).sort().reverse().slice(0, 5)
    : [];

  if (runFiles.length === 0) {
    console.log(yellow('  Nenhuma execução anterior encontrada.\n'));
  } else {
    console.log(bold('  Últimas execuções:'));
    console.log('');
    for (const f of runFiles) {
      try {
        const run = JSON.parse(fs.readFileSync(path.join(LOG_DIR, f), 'utf8'));
        const flag = run.dryRun ? ` ${cyan('[dry-run]')}` : '';
        console.log(`  ┌─ ${bold(run.runId)}${flag}`);
        console.log(`  │  CSV:           ${run.csvFile}`);
        console.log(`  │  Enviados:      ${green(run.summary.sent)}   Falhas: ${red(run.summary.failed)}   Não-registrados: ${yellow(run.summary.notRegistered)}   Total lote: ${run.summary.total}`);
        console.log(`  └─ Encerramento: ${run.stopReason}`);
        console.log('');
      } catch { /* arquivo corrompido — ignora */ }
    }
  }

  // ── Progresso no CSV selecionado ────────────────────────────────────────────
  if (csvPath) {
    if (!fs.existsSync(csvPath)) {
      console.log(red(`  CSV não encontrado: ${csvPath}\n`));
      return;
    }
    console.log(bold(`  Progresso em: ${path.basename(csvPath)}`));
    console.log('');
    try {
      const { records } = loadCSV(csvPath);
      const sentLog = readSentLog();
      const pending = records.filter(c => !sentLog[logKey(c.numero)]);
      const sentCount = records.length - pending.length;
      const pct = records.length > 0 ? Math.round(sentCount / records.length * 100) : 0;
      const filled = Math.round(pct / 5);
      const bar = '█'.repeat(filled) + '░'.repeat(20 - filled);

      console.log(`  Total no CSV:   ${records.length}`);
      console.log(`  Já enviados:    ${green(sentCount)} (${pct}%)`);
      console.log(`  Pendentes:      ${yellow(pending.length)}`);
      console.log(`  Progresso:      [${bar}] ${pct}%`);
      console.log('');

      if (pending.length === 0) {
        console.log('  ' + '═'.repeat(44));
        console.log(green(bold('  ✅ Lista concluída! Seguro iniciar nova campanha.')));
        console.log('  ' + '═'.repeat(44));
        console.log('');
      } else {
        const today = new Date().toISOString().slice(0, 10);
        const sentToday = Object.values(sentLog).filter(
          e => e.status === 'sent' && (e.sentAt || '').slice(0, 10) === today
        ).length;
        const remainingToday = Math.max(0, DAILY_SEND_CAP - sentToday);
        const daysLeft = Math.ceil(pending.length / DAILY_SEND_CAP);

        console.log(bold('  Capacidade de hoje:'));
        console.log(`  Cap diário:     ${DAILY_SEND_CAP}`);
        console.log(`  Enviados hoje:  ${sentToday}`);
        console.log(`  Saldo hoje:     ${green(remainingToday)} mensagem(ns) disponível(is)`);
        console.log(`  Estimativa:     ~${daysLeft} dia(s) útil(is) para concluir esta lista`);
        console.log('');
      }
    } catch (err) {
      console.log(red(`  Erro ao ler CSV: ${err.message}\n`));
    }
  } else {
    console.log(yellow('  Dica: selecione um CSV para ver o progresso detalhado da lista.\n'));
  }
}

// ── Comando: --reset ──────────────────────────────────────────────────────────
async function resetLog(runId) {
  if (runId) {
    const log  = readSentLog();
    let removed = 0;
    for (const [k, v] of Object.entries(log)) {
      if (v.runId === runId) { delete log[k]; removed++; }
    }
    writeSentLog(log);
    console.log(green(`✅ ${removed} entradas da execução "${runId}" removidas do log.`));
  } else {
    const ans = await ask(red('⚠️  Apagar TODO o log de envios? (s/N) '));
    if (ans.toLowerCase() !== 's') { console.log('Cancelado.'); return; }
    writeSentLog({});
    console.log(green('✅ Log de envios limpo com sucesso.'));
  }
}

// ── Detecção do Chrome instalado ───────────────────────────────────────────────
function findChrome() {
  const candidates = [
    // Windows
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    (process.env.LOCALAPPDATA || '') + '\\Google\\Chrome\\Application\\chrome.exe',
    // macOS
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    // Linux
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ];
  for (const p of candidates) {
    try { if (p && fs.existsSync(p)) return p; } catch { /* ignorar */ }
  }
  return null;
}

// ── Janela de horário ────────────────────────────────────────────────────────
function minuteOfDay(d = new Date()) { return d.getHours() * 60 + d.getMinutes(); }

function isInSendWindow() {
  const m = minuteOfDay();
  return SEND_WINDOWS.some(w => m >= w.startH * 60 + w.startM && m < w.endH * 60 + w.endM);
}

function msUntilNextWindow() {
  const m   = minuteOfDay();
  const day = 24 * 60;
  let best  = Infinity;
  for (const w of SEND_WINDOWS) {
    let diff = (w.startH * 60 + w.startM) - m;
    if (diff <= 0) diff += day;
    if (diff * 60_000 < best) best = diff * 60_000;
  }
  return best;
}

async function waitForSendWindow() {
  while (!isInSendWindow()) {
    const ms   = msUntilNextWindow();
    const next = new Date(Date.now() + ms);
    const hhmm = `${String(next.getHours()).padStart(2,'0')}:${String(next.getMinutes()).padStart(2,'0')}`;
    console.log(yellow(`\n⏸️  Fora da janela de envio. Retomando às ${hhmm} (${Math.ceil(ms/60000)} min)…`));
    await sleep(Math.min(ms, 5 * 60_000)); // reavalia a cada 5 min
  }
}

// ── Envio com retries ─────────────────────────────────────────────────────────
async function sendWithRetry(client, phone, message, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      await client.sendMessage(phone, message);
      return { ok: true };
    } catch (err) {
      // Detecta bloqueio/rate-limit do WhatsApp — interrompe o run imediatamente
      const isBlock = BLOCK_PATTERNS.some(p => p.test(err.message || ''));
      if (isBlock) return { ok: false, blocked: true, error: err.message };
      if (attempt <= retries) {
        process.stdout.write(yellow(` (retry ${attempt})`) + ' ');
        await sleep(2000 * attempt);
      } else {
        return { ok: false, error: err.message };
      }
    }
  }
}

// ── Envio com cadência humana ────────────────────────────────────────────────
async function sendHuman(client, phone, message) {
  const msgLen = message.length;

  // Fase 1 · leitura — abre o chat, verifica o histórico
  const readMs = Math.round(randomBetween(HUMAN.readMin, HUMAN.readMax));
  process.stdout.write(yellow(`\n   👁️  lendo… (${(readMs/1000).toFixed(1)}s) `));
  await sleep(readMs);

  // Fase 2 · pensamento — pausa antes de começar a compor
  const thinkMs = Math.round(randomBetween(HUMAN.thinkMin, HUMAN.thinkMax));
  process.stdout.write(yellow(`💭 pensando… (${(thinkMs/1000).toFixed(1)}s) `));
  await sleep(thinkMs);

  // Fase 3 · digitação — indicador "digitando…" visível no WhatsApp do destinatário
  const typeMs = Math.round(
    clamp(msgLen / randomBetween(HUMAN.typeSpeedMin, HUMAN.typeSpeedMax) * 1000,
          HUMAN.typeClampMin, HUMAN.typeClampMax)
  );
  process.stdout.write(yellow(`⌨️  digitando… (${(typeMs/1000).toFixed(1)}s)\n   `));
  try {
    const chat = await client.getChatById(phone);
    await chat.sendStateTyping();
    await sleep(typeMs);
    await chat.clearState();
  } catch { await sleep(typeMs); }

  // Envio real (com retry)
  return sendWithRetry(client, phone, message);
}

// ── Comando: --export-blacklist ───────────────────────────────────────────────
// Lê o sent_log e adiciona à blacklist.txt os números com status
// "skipped_not_registered" (sem WhatsApp) que ainda não estão na blacklist.
// Esses números nunca terão WhatsApp — sem sentido retentar em futuras campanhas.
function exportToBlacklist() {
  banner('EXPORTAR SEM-WHATSAPP → BLACKLIST');

  const BLACKLIST_PATH = path.join(DIR, '01_fontes', 'blacklist.txt');
  const log     = readSentLog();
  const entries = Object.values(log);

  // Números que nunca terão WhatsApp
  const semWpp = [...new Set(
    entries
      .filter(e => e.status === 'skipped_not_registered')
      .map(e => String(e.numero || '').replace(/\D/g, ''))
      .filter(n => n.length >= 10)
  )];

  // Números com falha (temporária ou permanente) — mostrar mas não auto-blacklist
  const falhas = [...new Set(
    entries
      .filter(e => e.status === 'failed')
      .map(e => String(e.numero || '').replace(/\D/g, ''))
      .filter(n => n.length >= 10)
  )];

  console.log(`  Total no log:              ${entries.length}`);
  console.log(`  Sem WhatsApp (skipped):    ${yellow(semWpp.length.toString())}`);
  console.log(`  Com falha (failed):        ${red(falhas.length.toString())}  ${falhas.length > 0 ? '← não exportados (erros podem ser temporários)' : ''}`);
  console.log('');

  if (semWpp.length === 0) {
    console.log(green('  Nenhum número novo para adicionar à blacklist.\n'));
    return;
  }

  // Lê blacklist atual
  let currentContent = '';
  const existingNums = new Set();
  if (fs.existsSync(BLACKLIST_PATH)) {
    currentContent = fs.readFileSync(BLACKLIST_PATH, 'utf8');
    for (const line of currentContent.split('\n')) {
      const t = line.trim();
      if (t && !t.startsWith('#')) existingNums.add(t.replace(/\D/g, ''));
    }
  }

  const novos = semWpp.filter(n => !existingNums.has(n));

  if (novos.length === 0) {
    console.log(green('  Todos os números sem WhatsApp já estão na blacklist.\n'));
    return;
  }

  const dataHoje = new Date().toISOString().slice(0, 10);
  const bloco    = `\n# --- Exportado automaticamente em ${dataHoje} (sem WhatsApp) ---\n` +
                   novos.join('\n') + '\n';

  // Garante que o arquivo existe
  if (!fs.existsSync(BLACKLIST_PATH)) {
    fs.writeFileSync(BLACKLIST_PATH,
      '# Blacklist de opt-out — números que pediram para não receber mensagens\n' +
      '# Formato: um número por linha (com ou sem DDI/DDD, o sistema normaliza)\n' +
      '# Linhas começando com # são ignoradas\n', 'utf8');
  }

  fs.appendFileSync(BLACKLIST_PATH, bloco, 'utf8');

  console.log(green(`  ✅ ${novos.length} número(s) adicionado(s) à blacklist:`));
  for (const n of novos) console.log(`     ${n}`);
  console.log('');
  console.log(`  Arquivo: ${cyan(BLACKLIST_PATH)}`);
  if (existingNums.size > 0) {
    console.log(`  Já existiam na blacklist: ${existingNums.size} (ignorados)`);
  }
  console.log('');
  console.log(yellow('  ⚡ Próxima vez que gerar lista (opção [3]), esses números serão excluídos automaticamente.\n'));
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  banner('WhatsApp Bulk Sender · Dra. Daiana Ferraz');

  // Comandos de utilitário (sem envio)
  if (STATUS)           { showStatus(); return; }
  if (RESUMO)           { showResumo(csvArg ? csvPath : null); return; }
  if (RESET)            { await resetLog(RESET_RUN); return; }
  if (EXPORT_BLACKLIST) { exportToBlacklist(); return; }

  if (!csvArg) {
    console.log(cyan(`ℹ️  Usando lista padrão: ${path.relative(DIR, csvPath)}`));
    console.log('');
  }

  if (DRY_RUN)    console.log(yellow('⚠️  MODO DRY-RUN — nenhuma mensagem será enviada\n'));
  if (HUMAN_MODE) console.log(cyan('🧠 Modo humano ativado: leitura → pensamento → digitação → pausa\n'));
  else            console.log(yellow('⚡ Modo direto (--no-human): delay fixo entre envios\n'));

  // ── 1. Carregar e deduplicar CSV ────────────────────────────────────────────
  let records, duplicates, total;
  try {
    ({ records, duplicates, total } = loadCSV(csvPath));
  } catch (err) {
    console.error(red(`❌ Erro ao ler CSV: ${err.message}`));
    process.exit(1);
  }

  console.log(`📋 ${bold('CSV:')} ${path.basename(csvPath)}`);
  console.log(`   Caminho utilizado:               ${csvPath}`);
  console.log(`   Total de linhas no CSV:          ${total}`);
  console.log(`   Duplicatas removidas:             ${duplicates}`);
  console.log(`   Únicos (numero × categoria):      ${records.length}\n`);

  // ── 2. Filtrar já enviados hoje ─────────────────────────────────────────────
  const sentLog   = readSentLog();
  const today     = new Date().toISOString().slice(0, 10);
  const sentToday = Object.values(sentLog).filter((entry) => entry.status === 'sent' && (entry.sentAt || '').slice(0, 10) === today).length;
  // Se --limit=N for explicitamente informado, usa N como cap do dia (override manual).
  const dailyCap = limitArg ? LIMIT : DAILY_SEND_CAP;
  const remainingToday = Math.max(0, dailyCap - sentToday);

  // Filtro por DDD (se informado via --ddd=XX)
  function getDDD(numero) {
    const d = String(numero).replace(/\D/g, '');
    return d.length >= 10 ? d.slice(0, 2) : '';
  }
  const toSend = records.filter(c => {
    if (sentLog[logKey(c.numero)]) return false;
    if (DDD_FILTER) {
      const ddd = (c.ddd || getDDD(c.numero));
      if (ddd !== DDD_FILTER) return false;
    }
    return true;
  });
  if (DDD_FILTER) {
    console.log(cyan(`🏙️  Filtro DDD ativo: apenas contatos com DDD ${DDD_FILTER}\n`));
  }
  const effectiveLimit = Math.min(LIMIT, remainingToday);
  const limited   = toSend.slice(0, effectiveLimit);

  console.log(`📊 ${bold('Fila:')}`);
  console.log(`   ${green('✅')} Já enviados (ignorados):        ${records.length - toSend.length - (DDD_FILTER ? records.filter(c => !sentLog[logKey(c.numero)] && (c.ddd || getDDD(c.numero)) !== DDD_FILTER).length : 0)}`)
  if (DDD_FILTER) {
    const outOfDDD = records.filter(c => !sentLog[logKey(c.numero)] && (c.ddd || getDDD(c.numero)) !== DDD_FILTER).length;
    console.log(`   ${yellow('🏙️')} Outros DDDs (aguardando):     ${outOfDDD}`);
  }
  console.log(`   ${cyan('📤')} Novos para enviar:             ${toSend.length}`);
  console.log(`   ${yellow('🛡️')} Limite diário seguro:           ${dailyCap}${limitArg ? ' (override)' : ''}`); 
  console.log(`   ${yellow('📆')} Já enviados hoje:               ${sentToday}`);
  console.log(`   ${yellow('⏳')} Restantes permitidos hoje:      ${remainingToday}`);
  console.log(`   ${yellow('⚠️ ')} Limite aplicado nesta execução: ${effectiveLimit}`);
  console.log(`   ${bold('→  Envios nesta execução:')}       ${limited.length}\n`);

  // Resumo por categoria
  const byCat = {};
  for (const c of limited) byCat[c.categoria] = (byCat[c.categoria] || 0) + 1;
  console.log(`📂 ${bold('Por categoria:')}`);
  for (const [cat, count] of Object.entries(byCat))
    console.log(`   ${cyan(cat)}: ${count}`);
  console.log('');

  if (limited.length === 0) {
    if (remainingToday <= 0) {
      console.log(yellow(`⚠️  Limite diário de ${dailyCap} mensagens já foi atingido hoje.`));
      console.log(yellow(`   Retome amanhã para continuar — ${toSend.length} contatos ainda pendentes nesta lista.`));
    } else {
      // toSend.length === 0: todos os contatos deste CSV já foram processados este mês
      console.log('═'.repeat(42));
      console.log(green(bold('  🏁 ARQUIVO CONCLUÍDO!')));
      console.log('═'.repeat(42));
      console.log(green(`  Todos os ${records.length} contatos desta lista foram processados este mês.`));
      console.log(green('  ✅ Seguro iniciar uma nova lista — sem risco de duplicatas.'));
      console.log(cyan(`  💡 Próximo passo: gere e envie uma nova lista.\n`));
    }
    showStatus();
    return;
  }

  // ── 3. Confirmação ──────────────────────────────────────────────────────────
  if (!DRY_RUN && !AUTO_YES) {
    if (HUMAN_MODE) {
      const avgMs = (HUMAN.readMin + HUMAN.readMax) / 2
                  + (HUMAN.thinkMin + HUMAN.thinkMax) / 2
                  + (HUMAN.typeClampMin + HUMAN.typeClampMax) / 2
                  + (HUMAN.cooldownMin + HUMAN.cooldownMax) / 2;
      console.log(yellow(`⚠️  Modo humano: leitura + pensamento + digitação + pausa por mensagem.`));
      console.log(`   Tempo médio por contato: ~${Math.ceil(avgMs / 1000)}s`);
      console.log(`   Tempo estimado total:    ~${Math.ceil(limited.length * avgMs / 60000)} minutos\n`);
    } else {
      console.log(`${yellow('⚠️ ')} Delay configurado: ${DELAY_MS}ms + até ${JITTER_MS}ms aleatório entre envios.`);
      console.log(`   Tempo estimado: ~${Math.ceil(limited.length * (DELAY_MS + JITTER_MS / 2) / 60000)} minutos\n`);
    }
    const ans = await ask(`Confirma o envio de ${bold(String(limited.length))} mensagens? (s/N) `);
    if (ans.toLowerCase() !== 's') {
      console.log(red('❌ Cancelado pelo usuário.'));
      process.exit(0);
    }
    console.log('');
  }

  // ── 4. DRY-RUN ──────────────────────────────────────────────────────────────
  if (DRY_RUN) {
    console.log(`📋 ${bold('Mensagens que seriam enviadas:')}\n`);
    for (const c of limited) {
      console.log(cyan(`  ▸ [${c.categoria}] +${String(c.numero).replace(/\D/g, '')} — ${c.nome}`));
      const preview = c.mensagem.split('\n').slice(0, 3).join(' ').slice(0, 100);
      console.log(`    ${yellow(preview)}…\n`);
    }
    console.log(green('✅ Dry-run concluído. Nenhuma mensagem enviada.'));
    return;
  }

  // ── 5. Iniciar cliente WhatsApp Web ─────────────────────────────────────────
  console.log('🔌 Iniciando WhatsApp Web (Puppeteer)...\n');
  const chromePath = findChrome();
  if (chromePath) console.log(`🌐 Chrome detectado: ${cyan(chromePath)}\n`);
  else            console.log(yellow('⚠️  Chrome não detectado localmente.\n'));

  const runId  = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const results = { sent: [], failed: [], notRegistered: [], blocked: [] };

  // Estado da sessão para identificar limite/reauth durante os disparos
  let shutdownRequested = false;
  let disconnectedByWA  = false;
  let readySeen         = false;
  let currentContact    = null;
  let reauthInfo        = null;
  const reauthEvents    = [];

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: 'dra-daiana-sender', dataPath: path.join(DIR, '.wwebjs_auth') }),
    puppeteer: {
      headless: true,
      executablePath: chromePath || undefined,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--disable-extensions',
        '--disable-background-networking',
      ],
    },
  });

  client.on('qr', qr => {
    if (readySeen) {
      const snapshot = {
        at: now(),
        reason: 'qr_requested_again',
        sent: results.sent.length,
        failed: results.failed.length,
        notRegistered: results.notRegistered.length,
        blockedByWA: results.blocked.length,
        processed: results.sent.length + results.failed.length + results.notRegistered.length + results.blocked.length,
        currentContact: currentContact
          ? { numero: currentContact.numero, nome: currentContact.nome, categoria: currentContact.categoria }
          : null,
      };
      reauthEvents.push(snapshot);
      if (!reauthInfo) reauthInfo = snapshot;
      disconnectedByWA = true;

      console.log(red('\n🔐 WhatsApp pediu autenticação novamente durante o envio.'));
      console.log(yellow(`   Envios concluídos antes do novo QR: ${snapshot.sent}`));
      console.log(yellow(`   Contatos processados até o evento: ${snapshot.processed}`));
      if (snapshot.currentContact)
        console.log(yellow(`   Último contato em andamento: ${snapshot.currentContact.nome} (${snapshot.currentContact.numero})`));
    }

    console.log('📱 Escaneie o QR Code com o WhatsApp do celular:\n');
    qrcode.generate(qr, { small: true });
    console.log(yellow('\n(aguardando autenticação — você tem 60 segundos...)\n'));
  });

  client.on('authenticated',  ()    => console.log(green('✅ WhatsApp autenticado!\n')));
  client.on('loading_screen', (percent, message) => {
    process.stdout.write(`\r   ⏳ Carregando WhatsApp Web… ${String(percent).padStart(3)}%  ${message || ''}              `);
    if (percent >= 100) process.stdout.write('\n');
  });
  client.on('auth_failure',   msg   => { console.error(red(`❌ Falha de autenticação: ${msg}`)); process.exit(1); });
  client.on('disconnected',   reason => {
    console.log(yellow(`⚠️  Desconectado: ${reason}`));
    disconnectedByWA = true; // pode indicar bloqueio ou perda de sessão — o loop verifica isso
  });

  await new Promise((resolve, reject) => {
    const READY_TIMEOUT_MS = 120_000; // 2 min — se o WhatsApp Web não carregar, aborta limpo
    const timeout = setTimeout(() => {
      reject(new Error(
        'Timeout: WhatsApp Web não ficou pronto em 120s.\n' +
        '  Possíveis causas:\n' +
        '  1. Sessão expirada — apague .wwebjs_auth e escaneie o QR novamente\n' +
        '  2. WhatsApp Web em manutenção — tente em alguns minutos\n' +
        '  3. Chrome sem memória — feche outros programas e tente novamente\n' +
        '  Comando para limpar sessão: Remove-Item -Recurse .wwebjs_auth'
      ));
    }, READY_TIMEOUT_MS);
    client.on('ready', () => {
      readySeen = true;
      clearTimeout(timeout);
      resolve();
    });
    client.initialize().catch(err => { clearTimeout(timeout); reject(err); });
  });
  console.log(green('✅ WhatsApp pronto. Iniciando envios...\n'));

  // ── 6. Enviar mensagens ──────────────────────────────────────────────────────

  // Graceful shutdown: destrói o cliente antes de sair por Ctrl+C ou sinal do SO
  const gracefulShutdown = async (signal) => {
    if (shutdownRequested) return;
    shutdownRequested = true;
    console.log(yellow(`\n⚠️  ${signal} recebido — encerrando com segurança…`));
    writeSentLog(sentLog);
    try { await client.destroy(); } catch { /* ignorar */ }
    process.exit(0);
  };
  process.once('SIGINT',  () => gracefulShutdown('SIGINT'));
  process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));

  for (let i = 0; i < limited.length; i++) {
    const contact = limited[i];
    const phone   = formatPhone(contact.numero);
    const key     = logKey(contact.numero);
    const prefix  = `[${String(i + 1).padStart(String(limited.length).length, ' ')}/${limited.length}]`;
    currentContact = contact;

    // Verificar janela de envio (modo humano)
    if (HUMAN_MODE && SEND_WINDOWS.length > 0) await waitForSendWindow();

    // Se o cliente perdeu a sessão / pediu novo QR, interrompe o run
    if (disconnectedByWA) {
      console.log(red('\n🚫 Envio interrompido por perda de sessão/reautenticação do WhatsApp.'));
      if (reauthInfo) {
        console.log(yellow(`   Limite suspeito detectado após ${reauthInfo.sent} envios concluídos.`));
        console.log(yellow(`   Total processado até o evento: ${reauthInfo.processed} contatos.`));
      } else {
        console.log(yellow('   Aguarde algumas horas e verifique o celular antes de tentar novamente.'));
      }
      break;
    }

    process.stdout.write(`${cyan(prefix)} ${contact.nome} (${contact.numero}) … `);

    // Verificar se número existe no WhatsApp
    let isRegistered;
    try   { isRegistered = await client.isRegisteredUser(phone); }
    catch { isRegistered = true; } // em caso de erro na verificação, tenta enviar

    if (!isRegistered) {
      console.log(yellow('⚠️  Não registrado no WhatsApp — pulando'));
      results.notRegistered.push(contact);
      sentLog[key] = { numero: contact.numero, nome: contact.nome, categoria: contact.categoria,
                       status: 'skipped_not_registered', sentAt: now(), runId };
      writeSentLog(sentLog);
      continue;
    }

    // Enviar (cadência humana ou retry simples)
    const result = HUMAN_MODE
      ? await sendHuman(client, phone, contact.mensagem)
      : await sendWithRetry(client, phone, contact.mensagem);

    if (result.blocked) {
      // WhatsApp bloqueou — registra e encerra o run imediatamente
      console.log(red(`\n🚫 BLOQUEADO PELO WHATSAPP: ${result.error}`));
      results.blocked.push({ ...contact, error: result.error });
      sentLog[key] = { numero: contact.numero, nome: contact.nome, categoria: contact.categoria,
                       status: 'blocked_by_whatsapp', error: result.error, sentAt: now(), runId };
      writeSentLog(sentLog);
      console.log(red('🛑 Envio interrompido — WhatsApp bloqueou a conta.'));
      console.log(yellow('   Aguarde algumas horas e verifique o celular antes de tentar novamente.'));
      break;
    } else if (result.ok) {
      console.log(green('✅ Enviado'));
      results.sent.push(contact);
      sentLog[key] = { numero: contact.numero, nome: contact.nome, categoria: contact.categoria,
                       status: 'sent', sentAt: now(), runId };
    } else {
      console.log(red(`❌ Falhou: ${result.error}`));
      results.failed.push({ ...contact, error: result.error });
      sentLog[key] = { numero: contact.numero, nome: contact.nome, categoria: contact.categoria,
                       status: 'failed', error: result.error, sentAt: now(), runId };
    }

    // Salva o log após cada envio (segurança: evita perda em crash)
    writeSentLog(sentLog);
    currentContact = null;

    // Pausa pós-envio antes do próximo contato
    if (i < limited.length - 1) {
      if (HUMAN_MODE) {
        const coolMs = Math.round(randomBetween(HUMAN.cooldownMin, HUMAN.cooldownMax));
        process.stdout.write(yellow(`   💤 próximo em ${(coolMs/1000).toFixed(1)}s…\n`));
        await sleep(coolMs);
      } else {
        const delay = DELAY_MS + Math.floor(Math.random() * JITTER_MS);
        await sleep(delay);
      }
    }
  }

  // ── 7. Salvar relatório de execução ─────────────────────────────────────────
  const reportFile = path.join(LOG_DIR, `run_${runId}.json`);
  const report = {
    runId,
    csvFile:     path.basename(csvPath),
    executedAt:  now(),
    dryRun:      false,
    stopReason:  results.blocked.length > 0 ? 'blocked_by_whatsapp' : reauthInfo ? 'reauth_requested' : 'completed',
    summary: {
      total:                 limited.length,
      sent:                  results.sent.length,
      failed:                results.failed.length,
      notRegistered:         results.notRegistered.length,
      blockedByWA:           results.blocked.length,
      reauthRequested:       Boolean(reauthInfo),
      sentBeforeReauth:      reauthInfo ? reauthInfo.sent : null,
      processedBeforeReauth: reauthInfo ? reauthInfo.processed : null,
    },
    reauth:        reauthInfo,
    reauthEvents,
    sent:          results.sent.map(c => ({ numero: c.numero, nome: c.nome, categoria: c.categoria })),
    failed:        results.failed.map(c => ({ numero: c.numero, nome: c.nome, categoria: c.categoria, error: c.error })),
    notRegistered: results.notRegistered.map(c => ({ numero: c.numero, nome: c.nome, categoria: c.categoria })),
    blocked:       results.blocked.map(c => ({ numero: c.numero, nome: c.nome, categoria: c.categoria, error: c.error })),
  };
  ensureDir(LOG_DIR);
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), 'utf8');

  // ── 8. Resumo final ──────────────────────────────────────────────────────────
  const pad = n => String(n).padEnd(6);
  console.log('\n' + '═'.repeat(42));
  console.log(bold('  RESUMO FINAL'));
  console.log('═'.repeat(42));
  console.log(`  ${green('✅ Enviados:           ')} ${pad(results.sent.length)}`);
  console.log(`  ${red('❌ Falhas:             ')} ${pad(results.failed.length)}`);
  console.log(`  ${yellow('⚠️  Não no WhatsApp:   ')} ${pad(results.notRegistered.length)}`);
  if (results.blocked.length > 0)
    console.log(`  ${red('🚫 Bloqueado p/ WA:   ')} ${pad(results.blocked.length)}`);
  if (reauthInfo)
    console.log(`  ${yellow('🔐 Antes do novo QR:   ')} ${pad(reauthInfo.sent)}`);
  console.log('─'.repeat(42));
  console.log(`  📄 Relatório: ${cyan(`log/run_${runId}.json`)}`);
  console.log(`  📋 Log geral: ${cyan('log/sent_log.json')}`);
  console.log('═'.repeat(42) + '\n');

  if (results.blocked.length > 0) {
    console.log(red(bold('  ⛔ BLOQUEADO PELO WHATSAPP:')));
    for (const b of results.blocked)
      console.log(red(`  🚫 ${b.nome} (${b.numero}): ${b.error}`));
    console.log(yellow('  Aguarde algumas horas antes de retomar os envios.\n'));
  }

  if (reauthInfo) {
    console.log(yellow(bold('  🔐 REAUTENTICAÇÃO SOLICITADA:')));
    console.log(yellow(`  Enviados antes do pedido de novo QR: ${reauthInfo.sent}`));
    console.log(yellow(`  Contatos processados até o evento: ${reauthInfo.processed}`));
    console.log(yellow(`  Horário do evento: ${reauthInfo.at}`));
    if (reauthInfo.currentContact)
      console.log(yellow(`  Último contato em andamento: ${reauthInfo.currentContact.nome} (${reauthInfo.currentContact.numero})`));
    console.log(yellow('  Isso normalmente indica perda de sessão ou limite percebido pelo WhatsApp.\n'));
  }

  if (results.failed.length > 0) {
    console.log(red(bold('  FALHAS (detalhe):')));
    for (const f of results.failed)
      console.log(red(`  ✗ ${f.nome} (${f.numero}): ${f.error}`));
    console.log('');
  }

  if (results.notRegistered.length > 0) {
    console.log(yellow(bold('  NÃO REGISTRADOS NO WHATSAPP:')));
    for (const n of results.notRegistered)
      console.log(yellow(`  ⚠ ${n.nome} (${n.numero})`));
    console.log('');
  }

  // ── 9. Status de conclusão do arquivo ────────────────────────────────────────
  // Após o run, verifica quantos contatos do CSV ainda estão pendentes este mês.
  if (results.blocked.length === 0 && !disconnectedByWA) {
    const logAfter      = readSentLog();
    const stillPending  = records.filter(c => !logAfter[logKey(c.numero)]).length;
    if (stillPending === 0) {
      console.log('═'.repeat(42));
      console.log(green(bold('  🏁 ARQUIVO CONCLUÍDO!')));
      console.log('═'.repeat(42));
      console.log(green(`  Todos os ${records.length} contatos desta lista foram processados este mês.`));
      console.log(green('  ✅ Seguro iniciar uma nova lista — sem risco de duplicatas.'));
      console.log(cyan(`  💡 Próximo passo: gere e envie uma nova lista.\n`));
    } else {
      const sentThisMonth = records.length - stillPending;
      console.log('─'.repeat(42));
      console.log(yellow(`  📋 Progresso do arquivo: ${sentThisMonth}/${records.length} processados`));
      console.log(yellow(`  ⏳ Ainda pendentes nesta lista: ${stillPending} contatos`));
      console.log(yellow(`  💡 Rode novamente ${stillPending <= DAILY_SEND_CAP ? 'amanhã' : 'nos próximos dias'} para continuar.\n`));
    }
  }

  await client.destroy();
  process.exit(0);
}

main().catch(err => {
  console.error(red(`\n💥 Erro fatal: ${err.message}`));
  console.error(err.stack);
  process.exit(1);
});
