#!/usr/bin/env node
/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║   WhatsApp Bulk Sender · Dra. Daiana Ferraz              ║
 * ║   Responsável técnico: Wesley Silva                      ║
 * ╚══════════════════════════════════════════════════════════╝
 *
 * USO:
 *   node sender.js                        → usa a lista padrão e limita a 50 envios/dia (100 no fim de semana)
 *   node sender.js --dry-run              → simula sem enviar usando a lista padrão
 *   node sender.js <csv>                  → envia usando um CSV específico
 *   node sender.js <csv> --yes            → envia sem confirmação
 *   node sender.js <csv> --limit=10       → limita a N envios (respeitando o teto dinâmico)
 *   node sender.js <csv> --delay=5000     → delay entre envios em ms (padrão: 4000)
 *   node sender.js --status               → mostra resumo do log
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
// Limite diário: 100 no fim de semana (sáb/dom), 50 nos dias úteis
const _dow = new Date().getDay(); // 0=Dom, 6=Sáb
const DAILY_SEND_CAP = (_dow === 0 || _dow === 6) ? 100 : 50;

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
const LOG_DIR     = path.join(DIR, 'log');
const SENT_LOG    = path.join(LOG_DIR, 'sent_log.json');
const DEFAULT_CSV = path.join(DIR, 'disparos', 'lista_disparos_A_20260408.csv');

// ── Argumentos ───────────────────────────────────────────────────────────────
const args      = process.argv.slice(2);
const csvArg    = args.find(a => !a.startsWith('--'));
const csvPath   = csvArg ? path.resolve(DIR, csvArg) : DEFAULT_CSV;
const DRY_RUN   = args.includes('--dry-run');
const AUTO_YES  = args.includes('--yes');
const STATUS    = args.includes('--status');
const RESET     = args.includes('--reset');
const RESET_RUN = (args.find(a => a.startsWith('--reset-run=')) || '').split('=')[1];
const limitArg  = args.find(a => a.startsWith('--limit='));
const delayArg  = args.find(a => a.startsWith('--delay='));
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
 * para o formato atual              numero_categoria_YYYYMM
 * Garante deduplicação correta entre runs antigas e novas.
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

function readSentLog() {
  ensureDir(LOG_DIR);
  if (!fs.existsSync(SENT_LOG)) return {};
  let log;
  try   { log = JSON.parse(fs.readFileSync(SENT_LOG, 'utf8')); }
  catch { return {}; }
  // migra chaves legadas e persiste se houve alteração
  const changed = migrateLegacyLogKeys(log);
  if (changed) writeSentLog(log);
  return log;
}

function writeSentLog(log) {
  ensureDir(LOG_DIR);
  fs.writeFileSync(SENT_LOG, JSON.stringify(log, null, 2), 'utf8');
}

/**
 * Chave única: numero_categoria_YYYYMM
 * Granularidade mensal → evita reenvio no mesmo mês (ex: campanha dia 08 e dia 10),
 * mas permite nova campanha no mês seguinte.
 */
function logKey(numero, categoria) {
  const ym = new Date().toISOString().slice(0, 7).replace('-', '');
  return `${String(numero).replace(/\D/g, '')}_${categoria}_${ym}`;
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
function showStatus() {
  banner('STATUS DO LOG DE ENVIOS');
  const log   = readSentLog();
  const entries = Object.values(log);
  if (entries.length === 0) {
    console.log(yellow('  Nenhum envio registrado ainda.\n'));
    return;
  }

  const byCat    = {};
  const byStatus = {};
  const byDate   = {};
  for (const e of entries) {
    byCat[e.categoria]    = (byCat[e.categoria]    || 0) + 1;
    byStatus[e.status]    = (byStatus[e.status]    || 0) + 1;
    const day = (e.sentAt || '').slice(0, 10);
    byDate[day]           = (byDate[day]            || 0) + 1;
  }

  console.log(bold('  Total de registros:'), entries.length);
  console.log('');
  console.log(bold('  Por status:'));
  for (const [s, n] of Object.entries(byStatus))
    console.log(`    ${s === 'sent' ? green('✅') : s === 'failed' ? red('❌') : yellow('⚠️ ')} ${s}: ${n}`);
  console.log('');
  console.log(bold('  Por categoria:'));
  for (const [c, n] of Object.entries(byCat))
    console.log(`    ${cyan(c)}: ${n}`);
  console.log('');
  console.log(bold('  Por data:'));
  for (const [d, n] of Object.entries(byDate).sort())
    console.log(`    ${d}: ${n}`);
  console.log('');
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

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  banner('WhatsApp Bulk Sender · Dra. Daiana Ferraz');

  // Comandos de utilitário (sem envio)
  if (STATUS) { showStatus(); return; }
  if (RESET)  { await resetLog(RESET_RUN); return; }

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
  const toSend    = records.filter(c => !sentLog[logKey(c.numero, c.categoria)]);
  const skippedAlready = records.length - toSend.length;
  const effectiveLimit = Math.min(LIMIT, remainingToday);
  const limited   = toSend.slice(0, effectiveLimit);

  console.log(`📊 ${bold('Fila:')}`);
  console.log(`   ${green('✅')} Já enviados hoje (ignorados):  ${skippedAlready}`);
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
    } else {
      console.log(green('✅ Nada a enviar — todas as mensagens desta lista já foram processadas hoje.'));
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

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: 'dra-daiana-sender', dataPath: path.join(DIR, '.wwebjs_auth') }),
    puppeteer: {
      headless: true,
      executablePath: chromePath || undefined,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    },
  });

  client.on('qr', qr => {
    console.log('📱 Escaneie o QR Code com o WhatsApp do celular:\n');
    qrcode.generate(qr, { small: true });
    console.log(yellow('\n(aguardando autenticação — você tem 60 segundos...)\n'));
  });

  client.on('authenticated',  ()    => console.log(green('✅ WhatsApp autenticado!\n')));
  client.on('auth_failure',   msg   => { console.error(red(`❌ Falha de autenticação: ${msg}`)); process.exit(1); });
  client.on('disconnected',   reason => console.log(yellow(`⚠️  Desconectado: ${reason}`)));

  await new Promise((resolve, reject) => {
    client.on('ready', resolve);
    client.initialize().catch(reject);
  });
  console.log(green('✅ WhatsApp pronto. Iniciando envios...\n'));

  // ── 6. Enviar mensagens ──────────────────────────────────────────────────────
  const runId  = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const results = { sent: [], failed: [], notRegistered: [] };

  // Graceful shutdown: destrói o cliente antes de sair por Ctrl+C ou sinal do SO
  let shutdownRequested = false;
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
    const key     = logKey(contact.numero, contact.categoria);
    const prefix  = `[${String(i + 1).padStart(String(limited.length).length, ' ')}/${limited.length}]`;

    // Verificar janela de envio (modo humano)
    if (HUMAN_MODE && SEND_WINDOWS.length > 0) await waitForSendWindow();

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

    if (result.ok) {
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
    summary: {
      total:         limited.length,
      sent:          results.sent.length,
      failed:        results.failed.length,
      notRegistered: results.notRegistered.length,
    },
    sent:          results.sent.map(c => ({ numero: c.numero, nome: c.nome, categoria: c.categoria })),
    failed:        results.failed.map(c => ({ numero: c.numero, nome: c.nome, categoria: c.categoria, error: c.error })),
    notRegistered: results.notRegistered.map(c => ({ numero: c.numero, nome: c.nome, categoria: c.categoria })),
  };
  ensureDir(LOG_DIR);
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), 'utf8');

  // ── 8. Resumo final ──────────────────────────────────────────────────────────
  const pad = n => String(n).padEnd(6);
  console.log('\n' + '═'.repeat(42));
  console.log(bold('  RESUMO FINAL'));
  console.log('═'.repeat(42));
  console.log(`  ${green('✅ Enviados:          ')} ${pad(results.sent.length)}`);
  console.log(`  ${red('❌ Falhas:            ')} ${pad(results.failed.length)}`);
  console.log(`  ${yellow('⚠️  Não no WhatsApp:  ')} ${pad(results.notRegistered.length)}`);
  console.log('─'.repeat(42));
  console.log(`  📄 Relatório: ${cyan(`log/run_${runId}.json`)}`);
  console.log(`  📋 Log geral: ${cyan('log/sent_log.json')}`);
  console.log('═'.repeat(42) + '\n');

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

  await client.destroy();
  process.exit(0);
}

main().catch(err => {
  console.error(red(`\n💥 Erro fatal: ${err.message}`));
  console.error(err.stack);
  process.exit(1);
});
