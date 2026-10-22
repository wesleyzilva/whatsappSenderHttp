#!/usr/bin/env node
/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║   WhatsApp Bulk Sender · Dra. Daiana Ferraz              ║
 * ║   Responsável técnico: Wesley Silva                      ║
 * ╚══════════════════════════════════════════════════════════╝
 */

'use strict';

const { parse } = require('csv-parse/sync');
const fs       = require('fs');
const path     = require('path');
const readline = require('readline');
const {
  Zap, MAX_CHIPS, ERR_DIR, withTimeout, dataHoraLocal, primeiraLinha, formatarNumero,
  identificadorZap, obterNumeroChip, mascarar,
  classificar, checarInternet, esperarInternet, iniciarMonitorInternet,
  setRunId, logEvento, logErro, instalarProtecaoGlobal, versaoLib,
  lerConfig, salvarConfig, resolverChip, adicionarChip, lerEstado, patchEstado,
  enviadosJanelaPorChip, timestampsJanela, ultimoEnvioChip, limiteEfetivo, registrarEnvio, quandoTemVagas,
  dentroDoHorario, proximaAbertura, descreverHorario, sessaoExiste,
} = require('./02a_zap_core');

const {
  analisarCampanha, imprimirFechamento, carregarBlacklist, semDDI, mesLocal, mesDoArquivo,
} = require('./06_gestao');

instalarProtecaoGlobal();

// ── Configurações ─────────────────────────────────────────────────────────────
const DEFAULT_DELAY_MS       = 4000;
const JITTER_MS              = 3000;
const MAX_RETRIES            = 2;
const MAX_TENTATIVAS_CONTATO = 3;
const MAX_RECUPERACOES       = 2;
const SEND_TIMEOUT_MS        = 120_000;
const FALHAS_SEGUIDAS_MAX    = 4;
const PAUSA_SUSPEITA_H       = 6;

const INFRA = new Set(['rede', 'pagina', 'logout', 'bloqueio']);

const DIR          = __dirname;
const LOG_DIR      = path.join(DIR, '03_log');
const SENT_LOG     = path.join(LOG_DIR, 'sent_log.json');
const CONTINUO_LOG = path.join(LOG_DIR, 'continuo.log');
const DEFAULT_CSV  = path.join(DIR, '02_disparos', 'lista_disparos_A_20260408.csv');

// ── Argumentos ───────────────────────────────────────────────────────────────
const args       = process.argv.slice(2);
const csvArg     = args.find(a => !a.startsWith('--'));
const csvPath    = csvArg ? path.resolve(DIR, csvArg) : DEFAULT_CSV;
const DRY_RUN    = args.includes('--dry-run');
const AUTO_YES   = args.includes('--yes');
const STATUS     = args.includes('--status');
const RESUMO     = args.includes('--resumo');
const RESET      = args.includes('--reset');
const RESET_RUN  = (args.find(a => a.startsWith('--reset-run=')) || '').split('=')[1];
const EXPORT_BLACKLIST = args.includes('--export-blacklist');
const limitArg   = args.find(a => a.startsWith('--limit='));
const delayArg   = args.find(a => a.startsWith('--delay='));
const dddArg     = args.find(a => a.startsWith('--ddd='));
const DDD_FILTER = dddArg ? dddArg.split('=')[1].trim() : null;
const parsedLimit = limitArg ? parseInt(limitArg.split('=')[1], 10) : Infinity;
const LIMIT      = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : Infinity;
const DELAY_MS   = delayArg ? parseInt(delayArg.split('=')[1], 10) : DEFAULT_DELAY_MS;

function argVal(nome) {
  const a = args.find(x => x === `--${nome}` || x.startsWith(`--${nome}=`));
  if (a === undefined) return undefined;
  return a.includes('=') ? a.slice(a.indexOf('=') + 1) : true;
}
const CMD_ZAPS        = args.includes('--zaps');
const CMD_ZAPS_RESUMO = args.includes('--zaps-resumo');
const CMD_ERROS       = args.includes('--erros');
const CMD_TESTAR      = argVal('testar');
const CMD_CONECTAR    = argVal('conectar');
const CMD_DESCONECTAR = argVal('desconectar');
const MODO_ARG        = argVal('modo');
const CHIPS_ARG       = argVal('chips');
const CONTINUO        = args.includes('--continuo');
const AGUARDAR_NOVO_CSV    = args.includes('--aguardar-novo-csv');
const PERMITIR_LISTA_ANTIGA = args.includes('--permitir-lista-antiga');
const FALHAS_CONEXAO_MAX   = 2;
const USAR_HORARIO    = args.includes('--usar-horario');
// Por padrão, ignora restrição de horário do dia e respeita apenas a janela móvel de 24h de cada número
const IGNORAR_HORARIO = !USAR_HORARIO || args.includes('--ignorar-horario');

// ── Utilitários ───────────────────────────────────────────────────────────────
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function colorize(text, code) { return `\x1b[${code}m${text}\x1b[0m`; }
const green  = t => colorize(t, 32);
const red    = t => colorize(t, 31);
const yellow = t => colorize(t, 33);
const cyan   = t => colorize(t, 36);
const bold   = t => colorize(t, 1);

const stripAnsi = s => String(s || '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');

/** Grava no console com horário [DD/MM/YYYY HH:mm:ss] e salva em 03_log/continuo.log */
function logHora(msg) {
  const linha = `[${dataHoraLocal()}] ${msg}`;
  console.log(linha);
  try {
    ensureDir(LOG_DIR);
    fs.appendFileSync(CONTINUO_LOG, stripAnsi(linha) + '\n', 'utf8');
  } catch { /* */ }
}

function fmtDataHora(ms) {
  if (!ms || !Number.isFinite(ms)) return 'nunca';
  return dataHoraLocal(new Date(ms));
}

function fmtHaQuantoTempo(ms, agora = Date.now()) {
  if (!ms || !Number.isFinite(ms)) return 'sem registro anterior';
  const diffMin = Math.max(0, Math.round((agora - ms) / 60_000));
  const h = Math.floor(diffMin / 60);
  const m = diffMin % 60;
  return h > 0 ? `há ${h}h${String(m).padStart(2, '0')}min` : `há ${m}min`;
}

function migrateLegacyLogKeys(log) {
  const LEGACY = /^(.+_[a-z_]+)_(\d{4})-(\d{2})-\d{2}$/;
  let changed = false;
  for (const oldKey of Object.keys(log)) {
    const m = oldKey.match(LEGACY);
    if (m) {
      const newKey = `${m[1]}_${m[2]}${m[3]}`;
      if (!log[newKey]) log[newKey] = log[oldKey];
      delete log[oldKey];
      changed = true;
    }
  }
  return changed;
}

const STATUS_PRIORITY = { sent: 3, failed: 2, skipped_not_registered: 1, blocked_by_whatsapp: 0 };
function migrateToPhoneOnlyKeys(log) {
  const OLD_FORMAT = /^(\d+)_[a-z_]+_(\d{6})$/;
  const merged = {};
  const toDelete = [];
  for (const [key, entry] of Object.entries(log)) {
    const m = key.match(OLD_FORMAT);
    if (!m) continue;
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
  const c1 = migrateLegacyLogKeys(log);
  const c2 = migrateToPhoneOnlyKeys(log);
  if (c1 || c2) writeSentLog(log);
  return log;
}

function writeSentLog(log) {
  ensureDir(LOG_DIR);
  fs.writeFileSync(SENT_LOG, JSON.stringify(log, null, 2), 'utf8');
}

/** Chave de deduplicação: telefone + mês LOCAL (igual ao 01_gerar_lista.py; UTC trocava o mês 3h antes da meia-noite). */
function logKey(numero) {
  return `${String(numero).replace(/\D/g, '')}_${mesLocal()}`;
}

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

// ── Leitura e deduplicação do CSV ─────────────────────────────────────────────
function loadCSV(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Arquivo não encontrado: ${filePath}`);
  let raw = fs.readFileSync(filePath, 'utf8');
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);

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

  const map = new Map();
  let duplicates = 0;
  for (const row of records) {
    if (!row.numero || !row.mensagem) continue;
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
    if (e.status === 'sent')        byRun[rid].sent++;
    else if (e.status === 'failed') byRun[rid].failed++;
    else                            byRun[rid].skipped++;
  }

  const sent    = byStatus['sent']                    || 0;
  const failed  = byStatus['failed']                  || 0;
  const skipped = byStatus['skipped_not_registered']  || 0;

  console.log(bold('  Total de registros:'), total);
  console.log('');

  const barSent = bar(sent, total);
  console.log(bold('  Progresso geral:'));
  console.log(`  [${green(barSent)}] ${pct(sent, total)} enviados com sucesso`);
  console.log(`  Enviados   : ${green(sent.toString().padStart(4))}  ${pct(sent, total)}`);
  console.log(`  Nao-reg.   : ${yellow(skipped.toString().padStart(4))}  ${pct(skipped, total)}`);
  console.log(`  Falhas     : ${red(failed.toString().padStart(4))}  ${pct(failed, total)}`);
  console.log('');

  console.log(bold('  Por telefone de disparo (zap):'));
  const cfg = lerConfig();
  const info = infoChips(cfg, log);
  for (const c of info) {
    const ult = c.ultimoEnvioMs ? `${fmtDataHora(c.ultimoEnvioMs)} (${fmtHaQuantoTempo(c.ultimoEnvioMs)})` : 'nunca enviou';
    console.log(`    ${cyan(c.rotulo.padEnd(34))} 24h: ${String(c.enviados).padStart(2)}/${c.cap}   último envio: ${ult}`);
  }
  console.log('');

  console.log(bold('  Por categoria:'));
  for (const [c, n] of Object.entries(byCat).sort((a, b) => b[1] - a[1]))
    console.log(`    ${cyan(c.padEnd(30))}: ${n.toString().padStart(4)}  (${pct(n, total)})`);
  console.log('');

  console.log(bold('  Por data:'));
  const dateEntries = Object.entries(byDate).sort();
  let cumulative = 0;
  for (const [d, n] of dateEntries) {
    cumulative += n;
    console.log(`    ${d}: ${n.toString().padStart(4)}  (${pct(n, total)} no dia)  acumulado: ${cumulative}/${total}  ${pct(cumulative, total)}`);
  }
  console.log('');
}

// ── Comando: --resumo ─────────────────────────────────────────────────────────
function showResumo(csvFile) {
  banner('RELATÓRIO DE SITUAÇÃO DA CAMPANHA');

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
        console.log(`  ┌─ ${bold(run.runId)}${flag}  (${run.executedAt ? fmtDataHora(Date.parse(run.executedAt)) : ''})`);
        console.log(`  │  CSV:           ${run.csvFile}`);
        console.log(`  │  Enviados:      ${green(run.summary.sent)}   Falhas: ${red(run.summary.failed)}   Não-registrados: ${yellow(run.summary.notRegistered)}   Total lote: ${run.summary.total}`);
        if (Array.isArray(run.zaps)) {
          for (const z of run.zaps) {
            const idTel = identificadorZap({ id: z.id, apelido: z.apelido, numero: z.numero });
            console.log(`  │    • ${idTel}: enviados=${z.enviados} (${z.parou})`);
          }
        }
        console.log(`  └─ Encerramento: ${run.stopReason}`);
        console.log('');
      } catch { /* */ }
    }
  }

  if (csvFile) {
    if (!fs.existsSync(csvFile)) {
      console.log(red(`  CSV não encontrado: ${csvFile}\n`));
      return;
    }
    console.log(bold(`  Progresso em: ${path.basename(csvFile)}`));
    console.log('');
    try {
      const sentLog = readSentLog();
      imprimirFechamento(analisarCampanha(csvFile, { sentLog }), { compacto: true });

      const cfgR  = lerConfig();
      const infoR = infoChips(cfgR, sentLog).filter(c => c.ativo);
      console.log(bold('  Situação de cada número (janela móvel de 24h):'));
      for (const c of infoR) {
        const ult = c.ultimoEnvioMs ? `${fmtDataHora(c.ultimoEnvioMs)} (${fmtHaQuantoTempo(c.ultimoEnvioMs)})` : 'sem envios registrados';
        const lib = c.liberaEm ? ` · libera 24h em ${fmtDataHora(c.liberaEm)}` : ' · LIBERADO AGORA';
        console.log(`    · ${cyan(c.rotulo.padEnd(34))} 24h: ${c.enviados}/${c.cap} (vagas: ${green(String(c.restante))}) | último envio: ${ult}${lib}`);
      }
      console.log('');
    } catch (err) {
      console.log(red(`  Erro ao ler CSV: ${err.message}\n`));
    }
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
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    (process.env.LOCALAPPDATA || '') + '\\Google\\Chrome\\Application\\chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ];
  for (const p of candidates) {
    try { if (p && fs.existsSync(p)) return p; } catch { /* */ }
  }
  return null;
}

// ── Envio com retries ─────────────────────────────────────────────────────────
async function sendWithRetry(client, phone, message, ctx = {}, retries = MAX_RETRIES) {
  const say = ctx.say || (s => process.stdout.write(s));
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      await withTimeout(client.sendMessage(phone, message, { sendSeen: false }), SEND_TIMEOUT_MS, 'sendMessage');
      return { ok: true };
    } catch (err) {
      const msg  = (err && err.message) || String(err);
      const tipo = classificar(msg);
      logErro('envio_falhou', err, { chip: ctx.chip, numeroChip: ctx.numeroChip, contato: ctx.contato, tentativa: attempt });
      if (INFRA.has(tipo)) return { ok: false, tipo, error: msg };
      if (attempt <= retries) {
        say(yellow(` (retry ${attempt})`) + ' ');
        await sleep(2000 * attempt);
      } else {
        return { ok: false, tipo, error: msg };
      }
    }
  }
}

// ── Comando: --export-blacklist ───────────────────────────────────────────────
function exportToBlacklist() {
  banner('EXPORTAR SEM-WHATSAPP → BLACKLIST');
  const BLACKLIST_PATH = path.join(DIR, '01_fontes', 'blacklist.txt');
  const log     = readSentLog();
  const entries = Object.values(log);

  const semWpp = [...new Set(
    entries
      .filter(e => e.status === 'skipped_not_registered')
      .map(e => String(e.numero || '').replace(/\D/g, ''))
      .filter(n => n.length >= 10)
  )];

  if (semWpp.length === 0) {
    console.log(green('  Nenhum número novo para adicionar à blacklist.\n'));
    return;
  }

  const existingNums = new Set();
  if (fs.existsSync(BLACKLIST_PATH)) {
    for (const line of fs.readFileSync(BLACKLIST_PATH, 'utf8').split('\n')) {
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
  const bloco    = `\n# --- Exportado automaticamente em ${dataHoje} (sem WhatsApp) ---\n` + novos.join('\n') + '\n';
  ensureDir(path.dirname(BLACKLIST_PATH));
  fs.appendFileSync(BLACKLIST_PATH, bloco, 'utf8');
  console.log(green(`  ✅ ${novos.length} número(s) adicionado(s) à blacklist.\n`));
}

// ── Zaps (chips) identificados por Número de Telefone ────────────────────────
function infoChips(cfg, sentLog) {
  const estado = lerEstado();
  const ef     = limiteEfetivo(cfg);
  const agora  = Date.now();
  return cfg.chips.map((c, i) => {
    const st       = estado[c.id] || {};
    const numero   = obterNumeroChip(c, estado, sentLog);
    const tsJanela = timestampsJanela(c.id, sentLog, cfg, agora, numero);
    const enviados = tsJanela.length;
    const ultimoMs = ultimoEnvioChip(c.id, sentLog, numero);
    const ate      = st.bloqueadoAte && Date.parse(st.bloqueadoAte) > agora ? st.bloqueadoAte : null;
    const rotulo   = identificadorZap({ id: c.id, apelido: c.apelido, numero });
    return {
      ...c,
      idx: i + 1,
      numero,
      rotulo,
      precisaQR: !!st.precisaQR,
      ultimoErro: st.ultimoErro || null,
      sessao: sessaoExiste(c.id),
      enviados,
      cap: ef,
      restante: Math.max(0, ef - enviados),
      bloqueadoAte: ate,
      ultimoEnvioMs: ultimoMs,
      primeiroNaJanelaMs: tsJanela.length ? tsJanela[0] : null,
      liberaEm: enviados >= ef ? quandoTemVagas(c.id, 1, sentLog, cfg, agora, numero) : null,
      liberaTotalEm: tsJanela.length ? (tsJanela[tsJanela.length - 1] + cfg.janelaHoras * 3_600_000 + 30_000) : null,
    };
  });
}

function listarChips() {
  banner('ZAPS / NÚMEROS DE ENVIO (JANELA MÓVEL DE 24H)');
  const cfg  = lerConfig();
  const info = infoChips(cfg, readSentLog());
  for (const c of info) {
    const situ = !c.ativo        ? yellow('inativo')
               : c.bloqueadoAte  ? red(`pausado até ${fmtDataHora(Date.parse(c.bloqueadoAte))}`)
               : !c.sessao       ? yellow('não conectado (use "Conectar número")')
               : c.precisaQR     ? red(`precisa ler o QR de novo${c.ultimoErro ? ` (${c.ultimoErro})` : ''}`)
               :                   green('conectado e pronto');
    const ultStr = c.ultimoEnvioMs
      ? `${bold(fmtDataHora(c.ultimoEnvioMs))} (${fmtHaQuantoTempo(c.ultimoEnvioMs)})`
      : yellow('nenhum envio registrado');
    console.log(`  [${c.idx}] ${cyan(bold(c.rotulo))}  ·  ${situ}`);
    console.log(`      • Últimas ${cfg.janelaHoras}h : ${bold(`${c.enviados}/${c.cap}`)} enviados  (disponível agora: ${green(bold(String(c.restante)))})`);
    console.log(`      • Último envio: ${ultStr}`);
    if (c.liberaEm) {
      console.log(`      • Libera 24h  : próxima vaga em ${yellow(bold(fmtDataHora(c.liberaEm)))} · lote completo 48/48 em ${fmtDataHora(c.liberaTotalEm)}`);
    } else {
      console.log(`      • Status 24h  : ${green('LIBERADO para enviar a qualquer hora')}`);
    }
  }
  const ativos = info.filter(c => c.ativo && c.sessao && !c.precisaQR && !c.bloqueadoAte);
  console.log('');
  console.log(`  Regra ativa: ${bold(`${limiteEfetivo(cfg)} envios por número a cada ${cfg.janelaHoras}h`)} · Horário: ${green('LIVRE (qualquer hora após as 24h)')}`);
  console.log(`  Capacidade imediata (números conectados e livres): ${green(bold(String(ativos.reduce((s, c) => s + c.restante, 0))))} mensagens\n`);
}

function zapsResumo() {
  const cfg  = lerConfig();
  const info = infoChips(cfg, readSentLog());
  const partes = info.map(c => {
    const st = !c.ativo ? 'inativo' : c.bloqueadoAte ? 'pausado' : !c.sessao ? 'nao conectado'
             : c.precisaQR ? 'precisa QR' : `${c.enviados}/${c.cap} em ${cfg.janelaHoras}h`;
    return `${c.idx}) ${c.rotulo} [${st}]`;
  });
  console.log(`Zaps       : ${partes.join('   ')}`);
}

function parseChipsArg(cfg, str) {
  const lista = [];
  for (const sel of String(str).split(',').map(s => s.trim()).filter(Boolean)) {
    const chip = resolverChip(cfg, sel);
    if (!chip) throw new Error(`Zap "${sel}" não existe. Use o número da lista (1-${cfg.chips.length}), telefone ou apelido.`);
    if (!lista.includes(chip)) lista.push(chip);
  }
  return lista;
}

function aoApertarEnter(cb) {
  const rl = readline.createInterface({ input: process.stdin });
  let ativo = true;
  rl.on('line', () => { if (ativo) { ativo = false; cb(); } });
  return () => { ativo = false; rl.close(); };
}

function dicaAtualizarLib(msg) {
  if (!/autenticou mas|"ready" não chegou/i.test(String(msg))) return;
  console.log(yellow('     Solução: menu [16] "Atualizar biblioteca" (ou: npm install whatsapp-web.js@latest).'));
}

// ── Comando: --testar ─────────────────────────────────────────────────────────
async function cmdTestar(sel) {
  banner('TESTAR CONEXÃO COM O ZAP');
  iniciarMonitorInternet();
  const cfg  = lerConfig();
  const slog = readSentLog();
  const info = infoChips(cfg, slog);
  const alvo = sel ? parseChipsArg(cfg, sel).map(c => info.find(x => x.id === c.id)) : info.filter(c => c.ativo);
  const chromePath = findChrome();
  const net = await checarInternet();
  console.log(`  Internet: ${net ? green('OK') : red('SEM CONEXÃO')}\n`);
  if (!net) return;

  console.log('  (pressione ENTER a qualquer momento para cancelar e voltar ao menu)\n');
  let zapAtual = null, cancelarTudo = false;
  const pararEnter = aoApertarEnter(() => { cancelarTudo = true; console.log(yellow('\n  Cancelando…')); if (zapAtual) zapAtual.cancelar(); });
  for (const c of alvo) {
    if (cancelarTudo) break;
    if (!sessaoExiste(c.id)) {
      console.log(`  ${bold(c.rotulo)}: ${yellow('sem sessão salva — use "Conectar número" para ler o QR')}\n`);
      continue;
    }
    const zap = new Zap(c, { chromePath });
    zapAtual = zap;
    process.stdout.write(`  ${bold(c.rotulo)}: conectando… `);
    try {
      await zap.conectar({ permitirQR: false, readyTimeoutMs: 90_000 });
      const r = await zap.testar();
      console.log(r.ok ? green('✅ CONECTADO') : red(`❌ ${r.estado}`));
      console.log(`     telefone      : ${cyan(bold( zap.rotulo ))}`);
      console.log(`     último envio  : ${c.ultimoEnvioMs ? `${fmtDataHora(c.ultimoEnvioMs)} (${fmtHaQuantoTempo(c.ultimoEnvioMs)})` : 'nenhum'}`);
      console.log(`     últimas ${cfg.janelaHoras}h   : ${c.enviados}/${c.cap} enviados (disponível: ${c.restante})`);
    } catch (e) {
      if (zap.cancelado) console.log(yellow('cancelado'));
      else {
        console.log(red(`❌ ${primeiraLinha(e.message)}`));
        if (classificar(e.message) === 'logout') console.log(yellow('     Sessão expirada/corrompida — use "Conectar número" para ler o QR de novo.'));
        dicaAtualizarLib(e.message);
      }
    } finally {
      await zap.fechar();
    }
    console.log('');
  }
  pararEnter();
}

// ── Comando: --conectar ───────────────────────────────────────────────────────
async function cmdConectar(sel) {
  banner('CONECTAR NÚMERO (QR CODE)');
  iniciarMonitorInternet();
  const cfg = lerConfig();
  const info = infoChips(cfg, readSentLog());
  let chip;

  if (sel) {
    chip = resolverChip(cfg, sel);
    if (!chip) { console.log(red(`  Zap "${sel}" não existe.\n`)); return; }
  } else {
    for (const c of info) {
      const st = !c.sessao ? yellow('não conectado') : c.precisaQR ? red('precisa ler QR de novo') : green('com sessão');
      console.log(`  [${c.idx}] ${cyan(c.rotulo)}  ·  ${st}`);
    }
    console.log(`  [N] Adicionar novo zap (${cfg.chips.length}/${MAX_CHIPS})\n`);
    const ans = await ask('  Qual zap conectar? (número, ou N para novo): ');
    if (/^n$/i.test(ans)) {
      if (cfg.chips.length >= MAX_CHIPS) { console.log(red(`\n  Limite de ${MAX_CHIPS} zaps atingido.\n`)); return; }
      const apelido = await ask(`  Apelido ou telefone do novo zap (Enter = Chip ${cfg.chips.length + 1}): `);
      chip = adicionarChip(cfg, apelido);
    } else {
      chip = resolverChip(cfg, ans);
      if (!chip) { console.log(red('\n  Opção inválida.\n')); return; }
    }
  }

  if (!chip.ativo) { chip.ativo = true; salvarConfig(cfg); }
  console.log(`\n  Conectando ${bold(chip.apelido)}…  (ENTER = cancelar e voltar ao menu)\n`);
  const zap = new Zap(chip, { chromePath: findChrome() });
  const pararEnter = aoApertarEnter(() => { console.log(yellow('\n  Cancelando…')); zap.cancelar(); });
  try {
    await zap.conectar({ permitirQR: true, qrTimeoutMs: 180_000, limparTela: true, dicaCancelar: 'ENTER = cancelar' });
    console.log(green(`\n  ✅ Conectado com sucesso: ${bold(zap.rotulo)}`));
    const est = lerEstado()[chip.id] || {};
    if (est.bloqueioMotivo === 'quarentena_conexao') {
      patchEstado(chip.id, { bloqueadoAte: null, bloqueioMotivo: null, falhasConexao: 0 });
      console.log(green('  Quarentena de conexão removida: o zap voltou a ser usado nos envios.'));
    }
  } catch (e) {
    if (zap.cancelado) console.log(yellow('\n  Cancelado. Voltando ao menu.\n'));
    else console.log(red(`\n  ❌ Não conectou: ${primeiraLinha(e.message)}\n`));
  } finally {
    pararEnter();
    await zap.fechar();
  }
}

// ── Comando: --desconectar ────────────────────────────────────────────────────
async function cmdDesconectar(sel) {
  banner('DESCONECTAR NÚMERO');
  iniciarMonitorInternet();
  const cfg = lerConfig();
  const info = infoChips(cfg, readSentLog());
  let chip;
  if (sel) chip = resolverChip(cfg, sel);
  else {
    for (const c of info) console.log(`  [${c.idx}] ${cyan(c.rotulo)}  ·  ${c.sessao ? green('com sessão') : yellow('não conectado')}`);
    console.log('');
    chip = resolverChip(cfg, await ask('  Qual zap desconectar? (número): '));
  }
  if (!chip) { console.log(red('\n  Zap inválido.\n')); return; }

  const ok = await ask(`  Confirma desconectar "${chip.apelido}"? (s/N) `);
  if (ok.toLowerCase() !== 's') { console.log('  Cancelado.\n'); return; }

  const zap = new Zap(chip, { chromePath: findChrome() });
  const r = await zap.desconectarConta();
  console.log(r.sessaoRemovida ? green('  ✅ Sessão local apagada.\n') : red('  ❌ Não consegui apagar a pasta da sessão.\n'));
}

// ── Comando: --erros ──────────────────────────────────────────────────────────
function lerJsonl(prefixo, dias) {
  if (!fs.existsSync(ERR_DIR)) return [];
  const limite = Date.now() - dias * 86_400_000;
  const re = new RegExp(`^${prefixo}_\\d{4}-\\d{2}-\\d{2}\\.jsonl$`);
  const regs = [];
  for (const f of fs.readdirSync(ERR_DIR).filter(f => re.test(f)).sort()) {
    for (const linha of fs.readFileSync(path.join(ERR_DIR, f), 'utf8').split('\n')) {
      if (!linha.trim()) continue;
      try { const r = JSON.parse(linha); if (Date.parse(r.ts) >= limite) regs.push(r); } catch { /* */ }
    }
  }
  return regs;
}

function showErros(dias = 7) {
  banner(`LOG DE ERROS — ÚLTIMOS ${dias} DIAS`);
  const erros = lerJsonl('erros', dias);
  if (erros.length === 0) {
    console.log(green('  Nenhum erro registrado no período.\n'));
    return;
  }
  console.log(bold(`  Total de erros: ${erros.length}\n`));
  console.log(bold('  Últimos 12 registros:'));
  for (const e of erros.slice(-12)) {
    const dt = fmtDataHora(Date.parse(e.ts));
    const idTel = e.numero ? formatarNumero(e.numero) : (e.chip || '-');
    console.log(`    [${dt}] ${yellow(String(e.tipo).padEnd(8))} ${cyan(String(idTel).padEnd(20))} ${e.evento}: ${primeiraLinha(e.mensagem).slice(0, 75)}`);
  }
  console.log('');
}

// ── Plano de distribuição (dry-run) ──────────────────────────────────────────
function planejar(lista, chips, modo) {
  const resta = new Map(chips.map(c => [c.id, c.restante]));
  const plano = [];
  if (modo === 'paralelo') {
    let i = 0;
    for (const ct of lista) {
      for (let t = 0; t < chips.length; t++) {
        const c = chips[i++ % chips.length];
        if (resta.get(c.id) > 0) { resta.set(c.id, resta.get(c.id) - 1); plano.push({ ct, chip: c }); break; }
      }
    }
  } else {
    let ci = 0;
    for (const ct of lista) {
      while (ci < chips.length && resta.get(chips[ci].id) <= 0) ci++;
      if (ci >= chips.length) break;
      resta.set(chips[ci].id, resta.get(chips[ci].id) - 1);
      plano.push({ ct, chip: chips[ci] });
    }
  }
  return plano;
}

// ── Parada segura ─────────────────────────────────────────────────────────────
const RUN = { zaps: [], sentLog: null, shutdown: false, paradaInstalada: false };

async function gracefulShutdown(signal) {
  if (RUN.shutdown) return;
  RUN.shutdown = true;
  logHora(yellow(`⚠️  ${signal} recebido — encerrando com segurança…`));
  logEvento('run_interrompido', { signal });
  try { if (RUN.sentLog) writeSentLog(RUN.sentLog); } catch { /* */ }
  RUN.zaps.forEach(z => { try { z.cancelar(); } catch { /* */ } });
  await Promise.all(RUN.zaps.map(z => z.fechar()));
  process.exit(0);
}

function instalarParada() {
  if (RUN.paradaInstalada) return;
  RUN.paradaInstalada = true;
  process.once('SIGINT',  () => gracefulShutdown('SIGINT'));
  process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', l => {
    if (/^\s*(p|parar|sair)\s*$/i.test(l)) gracefulShutdown('Pedido do usuário (P + Enter)');
    else if (l.trim()) console.log(yellow('   (para parar com segurança: digite P e pressione Enter)'));
  });
  console.log(cyan('ℹ️  Para parar com segurança a qualquer momento: digite P e pressione Enter.\n'));
}

// ── Plano do lote (verifica apenas as 24h de cada número) ─────────────────────
function getDDD(numero) {
  const d = String(numero).replace(/\D/g, '');
  return d.length >= 10 ? d.slice(0, 2) : '';
}

function montarPlano(csvFile, cfg, continuo) {
  const { records, duplicates, total } = loadCSV(csvFile);
  const sentLog = readSentLog();
  const infoAll = infoChips(cfg, sentLog);

  let selecionados;
  if (CHIPS_ARG !== undefined && CHIPS_ARG !== true) {
    selecionados = parseChipsArg(cfg, CHIPS_ARG).map(c => infoAll.find(i => i.id === c.id));
  } else {
    selecionados = infoAll.filter(c => c.ativo);
  }

  const blacklist = carregarBlacklist();
  let bloqueadosBlacklist = 0, pendentesForaDoFiltro = 0;
  const toSend = records.filter(c => {
    if (sentLog[logKey(c.numero)]) return false;
    if (blacklist.has(semDDI(c.numero))) { bloqueadosBlacklist++; return false; }
    if (DDD_FILTER && (c.ddd || getDDD(c.numero)) !== DDD_FILTER) { pendentesForaDoFiltro++; return false; }
    return true;
  });
  const jaEnviados = records.filter(c => sentLog[logKey(c.numero)]).length;

  const agora  = Date.now();
  const avisos = [];
  if (bloqueadosBlacklist > 0) {
    avisos.push(`${bloqueadosBlacklist} contato(s) da lista estão na blacklist (opt-out) e NÃO serão enviados.`);
  }

  // Filtra cada número respeitando apenas:
  // 1) se não está pausado por bloqueio
  // 2) se tem vaga disponível na janela móvel de 24h
  let elegiveis = selecionados.filter(c => {
    const ultTxt = c.ultimoEnvioMs ? `último envio: ${fmtDataHora(c.ultimoEnvioMs)} (${fmtHaQuantoTempo(c.ultimoEnvioMs, agora)})` : 'sem envios anteriores';
    if (c.bloqueadoAte) {
      avisos.push(`${c.rotulo}: pausado até ${fmtDataHora(Date.parse(c.bloqueadoAte))} | ${ultTxt}`);
      return false;
    }
    if (c.restante <= 0) {
      avisos.push(`${c.rotulo}: em janela de 24h (${c.enviados}/${c.cap}) · ${ultTxt} → libera em ${fmtDataHora(c.liberaEm)}`);
      return false;
    }
    return true;
  });

  // Filtra os conectados (sessão válida)
  const conectados = elegiveis.filter(c => c.sessao && !c.precisaQR);
  if (conectados.length > 0) {
    for (const c of elegiveis.filter(c => !conectados.includes(c))) {
      avisos.push(`${c.rotulo}: ${c.sessao ? `precisa ler QR de novo${c.ultimoErro ? ` (${c.ultimoErro})` : ''}` : 'não conectado'} — ignorado (use "Conectar número")`);
    }
    elegiveis = conectados;
  } else if (elegiveis.length > 0 && continuo) {
    for (const c of elegiveis) {
      avisos.push(`${c.rotulo}: ${c.sessao ? `precisa ler QR de novo${c.ultimoErro ? ` (${c.ultimoErro})` : ''}` : 'não conectado'} — use a opção [13] "Conectar número"`);
    }
    elegiveis = [];
  } else if (elegiveis.length > 0) {
    avisos.push(`Nenhum zap conectado — ${elegiveis[0].rotulo} vai pedir o QR Code.`);
    elegiveis = [elegiveis[0]];
  }

  // Só aplica filtro de horário se o usuário passar --usar-horario explicitamente
  const foraHorario = !IGNORAR_HORARIO && !dentroDoHorario(cfg, agora);
  if (foraHorario) {
    avisos.push(`Fora do horário configurado (${descreverHorario(cfg)}) — retoma ${fmtDataHora(proximaAbertura(cfg, agora))}`);
    elegiveis = [];
  }

  const capacidade     = elegiveis.reduce((s, c) => s + c.restante, 0);
  const effectiveLimit = Math.min(LIMIT, capacidade);
  const limited        = toSend.slice(0, effectiveLimit);

  // Calcula quando abre a próxima vaga de 24h
  let proxima = null, motivoEspera = null;
  if (limited.length === 0 && toSend.length > 0) {
    const candidatos = selecionados.filter(c => c.ativo !== false && c.sessao && !c.precisaQR);
    let t = null;
    for (const c of candidatos) {
      const bloqueio = c.bloqueadoAte ? Date.parse(c.bloqueadoAte) : 0;
      const livre    = Math.max(bloqueio, quandoTemVagas(c.id, 1, sentLog, cfg, agora, c.numero));
      if (t === null || livre < t) t = livre;
    }
    if (t === null) {
      t = agora + 15 * 60_000;
      motivoEspera = 'nenhum número conectado com sessão válida (escaneie o QR Code na opção 13)';
    } else {
      motivoEspera = 'aguardando completar as 24h do último envio';
    }
    proxima = IGNORAR_HORARIO ? t : proximaAbertura(cfg, Math.max(t, agora));
  }

  return { records, duplicates, total, sentLog, selecionados, elegiveis, avisos, toSend, limited, capacidade, jaEnviados, proxima, motivoEspera, pendentesForaDoFiltro };
}

// ── Execução de um lote ──────────────────────────────────────────────────────
async function rodarLote({ csvPath: csvFile, cfg, continuo = false, confirmar = true }) {
  const MODO     = MODO_ARG || cfg.modoPadrao;
  const PARALELO = MODO === 'paralelo';
  const PAUSA_H  = cfg.pausaBloqueioHoras;

  let P;
  try { P = montarPlano(csvFile, cfg, continuo); }
  catch (err) {
    logErro('plano_falhou', err, { csv: path.basename(csvFile) });
    logHora(red(`❌ Erro ao montar plano: ${err.message}`));
    if (!continuo) process.exit(1);
    return { tipo: 'erro', esperaMs: 5 * 60_000, motivo: primeiraLinha(err.message) };
  }
  const { records, duplicates, total, sentLog, selecionados, elegiveis, avisos, toSend, limited, capacidade, jaEnviados } = P;
  const ef = limiteEfetivo(cfg);

  if (limited.length === 0 || elegiveis.length === 0) {
    if (toSend.length === 0 && P.pendentesForaDoFiltro > 0) {
      const msg = `Nenhum contato pendente com DDD ${DDD_FILTER}, mas ainda restam ${P.pendentesForaDoFiltro} de outros DDDs neste arquivo. A campanha NÃO terminou: rode de novo com DDD "todos".`;
      logHora(yellow(`⚠️  ${msg}`));
      return { tipo: 'filtro_ddd', motivo: msg, pendentes: P.pendentesForaDoFiltro };
    }
    const concluido = toSend.length === 0;
    if (continuo) {
      return { tipo: concluido ? 'concluido' : 'aguardando', proximaMs: P.proxima, motivo: P.motivoEspera, pendentes: toSend.length, avisos, selecionados };
    }
    console.log(`📋 ${bold('CSV:')} ${path.basename(csvFile)}   ·   únicos: ${records.length}   ·   já processados: ${jaEnviados}   ·   pendentes: ${toSend.length}\n`);
    if (concluido) {
      console.log('═'.repeat(50));
      console.log(green(bold('  🏁 TODOS OS CONTATOS FORAM PROCESSADOS')));
      console.log('═'.repeat(50));
      imprimirFechamento(analisarCampanha(csvFile, { mes: mesLocal() }), { compacto: true });
    } else {
      logHora(red(bold('⛔ NÃO EXECUTADO — nenhum número liberado agora.')));
      for (const a of avisos) console.log(yellow(`   ⚠️  ${a}`));
      if (P.proxima) console.log(yellow(`   ⏳ Libera em: ${bold(fmtDataHora(P.proxima))}  (${P.motivoEspera})`));
      console.log('');
    }
    return { tipo: concluido ? 'concluido' : 'aguardando', proximaMs: P.proxima, pendentes: toSend.length };
  }

  // ── Cabeçalho do lote com horário e última execução de cada telefone ────────
  logHora(bold(`🚀 INICIANDO LOTE · CSV: ${path.basename(csvFile)} · Modo: ${MODO}`));
  console.log(`   Total únicos: ${records.length} | Já processados: ${jaEnviados} | Pendentes: ${toSend.length} | Envios neste lote: ${bold(String(limited.length))}`);
  if (DDD_FILTER) console.log(cyan(`   🏙️  Filtro DDD ativo: apenas contatos com DDD ${DDD_FILTER}`));
  console.log('');
  console.log(`📱 ${bold('Situação dos números (janela de 24h):')}`);
  for (const c of elegiveis) {
    const ult = c.ultimoEnvioMs ? `${fmtDataHora(c.ultimoEnvioMs)} (${fmtHaQuantoTempo(c.ultimoEnvioMs)})` : 'sem envios anteriores';
    console.log(`   • ${cyan(bold(c.rotulo))} → 24h: ${c.enviados}/${c.cap} (pode enviar até ${green(bold(String(c.restante)))} agora) | último envio: ${ult}`);
  }
  for (const a of avisos) console.log(yellow(`   ⚠️  ${a}`));
  console.log('');

  if (!DRY_RUN && confirmar) {
    const ans = await ask(`Confirma o envio de ${bold(String(limited.length))} mensagens agora? (s/N) `);
    if (ans.toLowerCase() !== 's') {
      console.log(red('❌ Cancelado pelo usuário.'));
      process.exit(0);
    }
    console.log('');
  }

  if (DRY_RUN) {
    const plano = planejar(limited, elegiveis, MODO);
    for (const { ct: c, chip } of plano) {
      console.log(cyan(`  ▸ [${chip.rotulo}] [${c.categoria}] +${String(c.numero).replace(/\D/g, '')} — ${c.nome}`));
    }
    console.log(green('\n✅ Dry-run concluído. Nenhuma mensagem enviada.'));
    return { tipo: 'dry-run' };
  }

  iniciarMonitorInternet();
  const chromePath = findChrome();
  const runId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  setRunId(runId);
  const inicio = Date.now();
  logEvento('run_inicio', { csv: path.basename(csvFile), modo: MODO, continuo, zaps: elegiveis.map(c => ({ id: c.id, numero: c.numero })), contatos: limited.length });

  const results         = { sent: [], failed: [], notRegistered: [], blocked: [] };
  const reauthEvents    = [];
  const currentContacts = new Map();
  const tentativas      = new Map();
  const queue           = [...limited];

  const zaps = elegiveis.map(c => {
    const z = new Zap(c, { chromePath });
    z.quota = c.restante;
    return z;
  });
  RUN.zaps = zaps;
  RUN.sentLog = sentLog;
  instalarParada();

  const registroBase = (zap, contact) => ({
    numero: contact.numero, nome: contact.nome, categoria: contact.categoria,
    chip: zap.id, de: zap.numero,
  });

  function registrarFalha(zap, contact, key, error) {
    results.failed.push({ ...contact, chip: zap.id, de: zap.numero, error });
    sentLog[key] = { ...registroBase(zap, contact), status: 'failed', error, sentAt: now(), runId };
    writeSentLog(sentLog);
  }

  function devolver(zap, contact, key, motivo) {
    const n = tentativas.get(key) || 0;
    if (n >= MAX_TENTATIVAS_CONTATO) {
      registrarFalha(zap, contact, key, `${primeiraLinha(motivo)} (após ${n} tentativas)`);
      return false;
    }
    queue.unshift(contact);
    return true;
  }

  function registrarReauth(zap) {
    if (reauthEvents.some(e => e.chip === zap.id)) return;
    const cc = currentContacts.get(zap.id);
    const snap = {
      at: now(), reason: zap.motivoDesconexao || zap.ultimoErro || 'sessao_perdida',
      chip: zap.id, numeroChip: zap.numero, rotulo: zap.rotulo,
      sent: results.sent.filter(c => c.chip === zap.id).length,
      failed: results.failed.filter(c => c.chip === zap.id).length,
      processed: results.sent.length + results.failed.length + results.notRegistered.length,
      currentContact: cc ? { numero: cc.numero, nome: cc.nome, categoria: cc.categoria } : null,
    };
    reauthEvents.push(snap);
    patchEstado(zap.id, { precisaQR: true, ultimoErro: snap.reason });
    logHora(red(`🔐 ${zap.rotulo}: sessão encerrada (${snap.reason}). Envios feitos antes da queda: ${snap.sent}. Refaça o QR na opção [13].`));
  }

  async function conectarChip(zap) {
    logHora(`🔌 Conectando ${bold(zap.rotulo)}…`);
    try {
      await zap.conectar({ permitirQR: !continuo });
      if ((lerEstado()[zap.id] || {}).falhasConexao) patchEstado(zap.id, { falhasConexao: 0 });
      logHora(green(`✅ ${bold(zap.rotulo)} conectado e pronto para enviar (quota: ${zap.quota} envios)`));
      return true;
    } catch (e) {
      const msg = primeiraLinha(e.message);
      zap.ultimoErro = msg;
      logHora(red(`❌ ${bold(zap.rotulo)} NÃO CONECTOU: ${msg}`));
      const tipoConexao = classificar(msg);
      if (tipoConexao === 'logout') {
        patchEstado(zap.id, { precisaQR: true, ultimoErro: msg });
        logHora(yellow(`   ↳ Sessão expirada/corrompida em ${zap.rotulo} — marcado para ler QR Code novamente (opção 13).`));
      } else if (tipoConexao !== 'rede' && !zap.cancelado) {
        // Disjuntor: não insistir num zap que falha seguidamente (cada tentativa custa ~15-90 s e, no modo contínuo, se repetia sem fim).
        const n = ((lerEstado()[zap.id] || {}).falhasConexao || 0) + 1;
        if (n >= FALHAS_CONEXAO_MAX) {
          patchEstado(zap.id, { falhasConexao: 0, ultimoErro: msg, bloqueioMotivo: 'quarentena_conexao', bloqueadoAte: new Date(Date.now() + PAUSA_SUSPEITA_H * 3_600_000).toISOString() });
          logHora(red(`🚫 ${zap.rotulo}: ${n} falhas seguidas de conexão — em quarentena por ${PAUSA_SUSPEITA_H}h. Releia o QR (opção 13) para liberar antes.`));
          logEvento('zap_quarentena', { chip: zap.id, numero: zap.numero, motivo: msg, horas: PAUSA_SUSPEITA_H });
        } else {
          patchEstado(zap.id, { falhasConexao: n, ultimoErro: msg });
        }
      }
      dicaAtualizarLib(msg);
      zap.motivoParada = `nao_conectou (${msg.slice(0, 60)})`;
      return false;
    }
  }

  async function trabalharChip(zap) {
    let enviados = 0, recuperacoes = 0, falhasSeguidas = 0;
    const tag = () => `[${zap.rotulo} · ${enviados + 1}/${zap.quota}]`;
    const restanteAgora = () => Math.max(0, ef - timestampsJanela(zap.id, sentLog, cfg, Date.now(), zap.numero).length);

    async function recuperar(motivo) {
      if (recuperacoes >= MAX_RECUPERACOES) return false;
      recuperacoes++;
      logHora(yellow(`🔄 ${zap.rotulo}: reiniciando o navegador (${primeiraLinha(motivo)})…`));
      try {
        await zap.reconectar();
        logHora(green(`✅ ${zap.rotulo}: reconectado com sucesso`));
        return true;
      } catch (e) {
        logErro('recuperacao_falhou', e, { chip: zap.id, numero: zap.numero, motivo: primeiraLinha(motivo) });
        logHora(red(`❌ ${zap.rotulo}: falha ao reconectar (${primeiraLinha(e.message)})`));
        return false;
      }
    }

    async function tratarInfra(tipo, e) {
      if (zap.sessaoPerdida) { registrarReauth(zap); return 'parar'; }
      if (tipo === 'rede') {
        return (await esperarInternet({ motivo: `${zap.rotulo}: falha de rede no envio`, maxMs: 30 * 60_000 })) ? 'continuar' : 'parar';
      }
      if (tipo === 'pagina') return (await recuperar(e.message)) ? 'continuar' : 'parar';
      if (tipo === 'logout') { zap.sessaoPerdida = true; registrarReauth(zap); return 'parar'; }
      if (tipo === 'bloqueio') {
        zap.bloqueado = true;
        patchEstado(zap.id, { bloqueadoAte: new Date(Date.now() + PAUSA_H * 3_600_000).toISOString(), ultimoErro: primeiraLinha(e.message) });
        logHora(red(`🚫 ${zap.rotulo}: WhatsApp limitou o envio (${primeiraLinha(e.message)}). Número pausado por ${PAUSA_H}h.`));
        return 'parar';
      }
      return 'continuar';
    }

    while (queue.length && enviados < zap.quota && !RUN.shutdown) {
      if (restanteAgora() <= 0) { zap.motivoParada = 'limite_24h_atingido'; break; }
      if (!IGNORAR_HORARIO && !dentroDoHorario(cfg)) { zap.motivoParada = 'fora_do_horario'; break; }

      if (falhasSeguidas >= FALHAS_SEGUIDAS_MAX) {
        zap.bloqueado = true;
        patchEstado(zap.id, { bloqueadoAte: new Date(Date.now() + PAUSA_SUSPEITA_H * 3_600_000).toISOString(), ultimoErro: `${falhasSeguidas} falhas seguidas` });
        logHora(red(`🚫 ${zap.rotulo}: ${falhasSeguidas} falhas seguidas — pausado por ${PAUSA_SUSPEITA_H}h por segurança.`));
        zap.motivoParada = 'suspeita_bloqueio';
        break;
      }

      if (zap.sessaoPerdida || !zap.pronto) { registrarReauth(zap); zap.motivoParada = 'sessao_perdida'; break; }

      if (!(await esperarInternet({ motivo: `${zap.rotulo}: antes de enviar`, maxMs: 30 * 60_000 }))) {
        zap.motivoParada = 'sem_internet'; break;
      }

      const saude = await zap.testar();
      if (!saude.ok) {
        logHora(yellow(`⚠️  ${zap.rotulo}: WhatsApp Web em estado "${saude.estado}"`));
        if (zap.sessaoPerdida) { registrarReauth(zap); zap.motivoParada = 'sessao_perdida'; break; }
        if (await recuperar(`estado ${saude.estado}`)) continue;
        zap.motivoParada = `sem_saude (${saude.estado})`; break;
      }

      const contact = queue.shift();
      const phone   = formatPhone(contact.numero);
      const key     = logKey(contact.numero);
      tentativas.set(key, (tentativas.get(key) || 0) + 1);
      currentContacts.set(zap.id, contact);

      // Verificar se o número do destinatário tem WhatsApp
      let isRegistered = true;
      try {
        isRegistered = await withTimeout(zap.client.isRegisteredUser(phone), 45_000, 'isRegisteredUser');
      } catch (e) {
        const tipo = classificar(e.message);
        logErro('verificar_registro_falhou', e, { chip: zap.id, numero: zap.numero, contato: mascarar(contact.numero) });
        if (INFRA.has(tipo)) {
          logHora(yellow(`${tag()} ${contact.nome} (${contact.numero}) → ⚠️ erro de ${tipo} ao verificar: ${primeiraLinha(e.message)}`));
          devolver(zap, contact, key, e.message);
          currentContacts.delete(zap.id);
          if ((await tratarInfra(tipo, e)) === 'parar') { zap.motivoParada = zap.sessaoPerdida ? 'sessao_perdida' : tipo; break; }
          continue;
        }
        isRegistered = true;
      }

      if (!isRegistered) {
        logHora(yellow(`${tag()} ${contact.nome} (${contact.numero}) → ⚠️ Não tem WhatsApp (pulando)`));
        results.notRegistered.push({ ...contact, chip: zap.id, de: zap.numero });
        sentLog[key] = { ...registroBase(zap, contact), status: 'skipped_not_registered', sentAt: now(), runId };
        writeSentLog(sentLog);
        currentContacts.delete(zap.id);
        continue;
      }

      // Enviar mensagem
      const ctx = { chip: zap.id, numeroChip: zap.numero, contato: mascarar(contact.numero), abortar: () => zap.sessaoPerdida };
      const result = await sendWithRetry(zap.client, phone, contact.mensagem, ctx);

      if (result.ok) {
        enviados++;
        falhasSeguidas = 0;
        results.sent.push({ ...contact, chip: zap.id, de: zap.numero });
        sentLog[key] = { ...registroBase(zap, contact), status: 'sent', sentAt: now(), runId };
        writeSentLog(sentLog);
        registrarEnvio(zap.id, Date.now(), zap.numero);
        logHora(green(`[${zap.rotulo} · ${enviados}/${zap.quota}] ${contact.nome} (${contact.numero}) → ✅ ENVIADO`));
      } else if (INFRA.has(result.tipo)) {
        logHora(yellow(`${tag()} ${contact.nome} (${contact.numero}) → ⚠️ falha de ${result.tipo}: ${primeiraLinha(result.error)}`));
        if (result.tipo === 'pagina') registrarEnvio(zap.id, Date.now(), zap.numero);
        if (result.tipo === 'pagina' || result.tipo === 'bloqueio') falhasSeguidas++;
        devolver(zap, contact, key, result.error);
        if (result.tipo === 'bloqueio') results.blocked.push({ ...contact, chip: zap.id, de: zap.numero, error: result.error });
        const acao = await tratarInfra(result.tipo, new Error(result.error));
        currentContacts.delete(zap.id);
        if (acao === 'parar') { zap.motivoParada = zap.sessaoPerdida ? 'sessao_perdida' : `${result.tipo} (${primeiraLinha(result.error).slice(0, 50)})`; break; }
        continue;
      } else {
        logHora(red(`${tag()} ${contact.nome} (${contact.numero}) → ❌ FALHOU: ${primeiraLinha(result.error)}`));
        registrarFalha(zap, contact, key, result.error);
        falhasSeguidas++;
      }
      currentContacts.delete(zap.id);

      if (queue.length && enviados < zap.quota) {
        await sleep(DELAY_MS + Math.floor(Math.random() * JITTER_MS));
      }
    }

    if (!zap.motivoParada) {
      zap.motivoParada = enviados >= zap.quota ? 'teto_48_envios_concluido' : (queue.length ? 'interrompido' : 'fila_concluida');
    }
    zap.enviadosRun = enviados;
    logHora(cyan(`🏁 ${zap.rotulo} finalizou participação no lote: ${bold(String(enviados))} enviado(s) · motivo: ${zap.motivoParada}`));
    await zap.fechar();
  }

  // ── Executar (Paralelo ou Sequencial) ────────────────────────────────────────
  if (PARALELO) {
    const prontos = [];
    for (const z of zaps) if (await conectarChip(z)) prontos.push(z);
    if (prontos.length === 0) logHora(red('🚫 Nenhum número conseguiu conectar neste lote.'));
    else logHora(green(`🚀 Disparando em paralelo com ${prontos.length} número(s)…`));
    await Promise.all(prontos.map(trabalharChip));
    await Promise.all(zaps.map(z => z.fechar()));
  } else {
    for (const z of zaps) {
      if (!queue.length || RUN.shutdown) break;
      if (!IGNORAR_HORARIO && !dentroDoHorario(cfg)) { z.motivoParada = 'fora_do_horario'; continue; }
      if (await conectarChip(z)) {
        await trabalharChip(z);
        if (z.motivoParada === 'teto_48_envios_concluido' && queue.length) {
          logHora(cyan(`↪️  ${z.rotulo} atingiu o teto de ${ef} envios nas 24h — passando para o próximo número.`));
        }
      }
      await z.fechar();
    }
  }

  // ── Relatório de execução ───────────────────────────────────────────────────
  const reauthInfo = reauthEvents[0] || null;
  const stopReason = results.blocked.length > 0 ? 'blocked_by_whatsapp'
                   : reauthInfo                  ? 'reauth_requested'
                   : queue.length > 0            ? 'incomplete'
                   :                               'completed';
  const reportFile = path.join(LOG_DIR, `run_${runId}.json`);
  const report = {
    runId,
    csvFile:     path.basename(csvFile),
    executedAt:  now(),
    dryRun:      false,
    modo:        MODO,
    continuo,
    duracaoSeg:  Math.round((Date.now() - inicio) / 1000),
    stopReason,
    summary: {
      total:           limited.length,
      sent:            results.sent.length,
      failed:          results.failed.length,
      notRegistered:   results.notRegistered.length,
      blockedByWA:     results.blocked.length,
      pendentes:       queue.length,
      reauthRequested: Boolean(reauthInfo),
    },
    zaps: zaps.map(z => ({
      id: z.id,
      apelido: z.apelido,
      numero: z.numero,
      identificador: z.rotulo,
      enviados: z.enviadosRun || 0,
      parou: z.motivoParada || 'nao_iniciou',
    })),
    reauthEvents,
    sent:          results.sent,
    failed:        results.failed,
    notRegistered: results.notRegistered,
    blocked:       results.blocked,
  };
  ensureDir(LOG_DIR);
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), 'utf8');
  logEvento('run_fim', { stopReason, ...report.summary, duracaoSeg: report.duracaoSeg });

  // ── Resumo final detalhado por número de telefone ───────────────────────────
  const infoDepois = infoChips(cfg, sentLog);
  console.log('\n' + '═'.repeat(64));
  logHora(bold('RESUMO DO LOTE'));
  console.log('═'.repeat(64));
  console.log(`  ${green('✅ Enviados neste lote:')} ${bold(String(results.sent.length))}`);
  console.log(`  ${red('❌ Falhas:             ')} ${results.failed.length}`);
  console.log(`  ${yellow('⚠️  Não no WhatsApp:   ')} ${results.notRegistered.length}`);
  if (queue.length > 0) console.log(`  ${yellow('⏳ Não enviados:      ')} ${queue.length} (voltam no próximo lote)`);
  console.log('─'.repeat(64));
  console.log(bold('  Resultado por Número de Telefone:'));
  for (const z of zaps) {
    const stAtual = infoDepois.find(x => x.id === z.id);
    const acum24h = stAtual ? `${stAtual.enviados}/${stAtual.cap}` : '?';
    const ultStr  = stAtual && stAtual.ultimoEnvioMs ? fmtDataHora(stAtual.ultimoEnvioMs) : 'nunca';
    const libStr  = stAtual && stAtual.liberaEm ? ` · libera 24h em ${fmtDataHora(stAtual.liberaEm)}` : '';
    console.log(`   • ${cyan(bold(z.rotulo.padEnd(32)))} | lote: ${bold(String(z.enviadosRun || 0).padStart(2))} | 24h: ${acum24h} | últ. envio: ${ultStr}${libStr} | status: ${z.motivoParada || 'nao_iniciou'}`);
  }
  console.log('─'.repeat(64));
  console.log(`  📄 Relatório do lote : ${cyan(`03_log/run_${runId}.json`)}`);
  console.log(`  🕒 Log contínuo      : ${cyan('03_log/continuo.log')}`);
  console.log(`  📋 Log geral         : ${cyan('03_log/sent_log.json')}`);
  console.log('═'.repeat(64) + '\n');

  await Promise.all(zaps.map(z => z.fechar()));
  RUN.zaps = [];
  return {
    tipo: 'enviou',
    enviados: results.sent.length,
    falhas: results.failed.length,
    pendentes: queue.length,
    bloqueios: results.blocked.length,
    reauth: reauthEvents.length,
  };
}

// ── Modo contínuo ─────────────────────────────────────────────────────────────
function escolherCsvContinuo() {
  if (csvArg) return csvPath;
  const dir = path.join(DIR, '02_disparos');
  if (!fs.existsSync(dir)) return null;
  const arq = fs.readdirSync(dir).filter(f => /\.csv$/i.test(f))
    .map(f => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  return arq.length ? path.join(dir, arq[0].f) : null;
}

async function dormir(ms) {
  const fim = Date.now() + ms;
  while (!RUN.shutdown && Date.now() < fim) await sleep(Math.min(15_000, fim - Date.now()));
}

async function modoContinuo() {
  banner('MODO CONTÍNUO · ENVIO A QUALQUER HORA (JANELA 24H POR NÚMERO)');
  const cfg0 = lerConfig();
  logHora(`Modo contínuo iniciado · Teto: ${limiteEfetivo(cfg0)} envios por número a cada ${cfg0.janelaHoras}h · Horário: LIVRE (24/7)`);
  console.log(`  • Log com horário salvo continuamente em: ${cyan('03_log/continuo.log')}`);
  console.log(`  • Para parar com segurança: digite P e Enter\n`);

  if (!AUTO_YES) {
    const ans = await ask('Iniciar o modo contínuo agora? (s/N) ');
    if (ans.toLowerCase() !== 's') { console.log(red('❌ Cancelado.')); return; }
    console.log('');
  }
  iniciarMonitorInternet();
  instalarParada();
  logEvento('continuo_inicio', { csv: csvArg ? path.basename(csvPath) : 'mais_recente' });

  let semProgresso = 0;

  while (!RUN.shutdown) {
    const cfg = lerConfig();
    const csv = escolherCsvContinuo();
    let espera = 10 * 60_000;

    const mesCsv = csv ? mesDoArquivo(path.basename(csv)) : null;
    if (!csv) {
      logHora(yellow('Nenhum CSV em 02_disparos — aguardando nova lista...'));
    } else if (!csvArg && !PERMITIR_LISTA_ANTIGA && mesCsv && mesCsv < mesLocal()) {
      logHora(red(`🛑 A lista mais recente (${path.basename(csv)}) é de um mês anterior. Para não reenviar automaticamente para quem já recebeu, o modo contínuo não vai usá-la.`));
      logHora(yellow('   → Gere uma lista nova (menu [3]) ou, se for proposital, rode com --permitir-lista-antiga.'));
      logEvento('continuo_lista_antiga_recusada', { csv: path.basename(csv) });
      break;
    } else {
      let r;
      try { r = await rodarLote({ csvPath: csv, cfg, continuo: true, confirmar: false }); }
      catch (e) {
        logErro('lote_falhou', e, { csv: path.basename(csv) });
        r = { tipo: 'erro', esperaMs: 5 * 60_000, motivo: primeiraLinha(e.message) };
      }

      if (r.tipo === 'enviou') {
        if (r.enviados > 0) {
          semProgresso = 0;
          espera = 30_000; // Verifica imediatamente em 30s se outro número tem vaga
          logHora(green(`✅ Lote enviou ${r.enviados} mensagem(ns).Restam ${r.pendentes} pendentes. Próxima verificação em 30s.`));
        } else {
          semProgresso++;
          espera = Math.min(10 * 60_000 * semProgresso, 60 * 60_000);
          logHora(yellow(`⚠️  Lote terminou com 0 envios — nova tentativa em ${Math.round(espera / 60_000)} min.`));
        }
      } else if (r.tipo === 'aguardando') {
        const ate = r.proximaMs || (Date.now() + 10 * 60_000);
        espera = Math.min(Math.max(ate - Date.now(), 30_000), 15 * 60_000);
        logHora(yellow(`⏳ Aguardando janela de 24h — ${r.pendentes} contato(s) pendente(s) em ${path.basename(csv)}.`));
        if (Array.isArray(r.avisos)) {
          for (const a of r.avisos) logHora(yellow(`   • ${a}`));
        }
        logHora(cyan(`   → Próxima liberação prevista: ${bold(fmtDataHora(ate))} (${r.motivo || 'aguardando 24h'}) · rechecagem em ${Math.round(espera / 60_000)} min.`));
        if (/nenhum número conectado/i.test(r.motivo || '')) {
          logHora(red('🔴 AÇÃO NECESSÁRIA: nenhum zap está conectado. Conecte um zap (menu [13] ou botão "Conectar (QR)" no painel); o modo contínuo não consegue enviar sozinho.'));
          logEvento('acao_necessaria', { motivo: 'nenhum_zap_conectado', pendentes: r.pendentes });
        }
      } else if (r.tipo === 'concluido') {
        const fech = analisarCampanha(csv, { mes: mesLocal() });
        logEvento('continuo_campanha_concluida', { csv: path.basename(csv), status: fech.status, enviados: fech.enviados, semWhatsapp: fech.semWhatsapp, falhas: fech.falhas });
        logHora(green(`🏁 Lista ${path.basename(csv)} totalmente processada.`));
        imprimirFechamento(fech, { compacto: true });
        if (!AGUARDAR_NOVO_CSV) {
          logHora(green('Modo contínuo encerrado: a campanha terminou. Gere a próxima lista (menu [3]) e inicie de novo quando quiser.'));
          logEvento('continuo_fim', { motivo: 'campanha_concluida', csv: path.basename(csv) });
          break;
        }
        logHora(cyan('Aguardando novo CSV em 02_disparos (rechecagem em 10 min) — modo --aguardar-novo-csv.'));
        espera = 10 * 60_000;
      } else if (r.tipo === 'filtro_ddd') {
        logEvento('continuo_fim', { motivo: 'sem_pendentes_no_ddd', pendentes: r.pendentes });
        break;
      } else if (r.tipo === 'erro') {
        espera = r.esperaMs;
        logHora(red(`❌ Erro no lote (${r.motivo}) — nova tentativa em ${Math.round(espera / 60_000)} min.`));
      }
    }
    await dormir(espera);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (CMD_ZAPS_RESUMO) { zapsResumo(); return; }

  banner('WhatsApp Bulk Sender · Dra. Daiana Ferraz');

  if (STATUS)           { showStatus(); return; }
  if (RESUMO)           { showResumo(csvArg ? csvPath : null); return; }
  if (RESET)            { await resetLog(RESET_RUN); return; }
  if (EXPORT_BLACKLIST) { exportToBlacklist(); return; }
  if (CMD_ZAPS)         { listarChips(); return; }
  if (CMD_ERROS)        { showErros(); return; }
  if (CMD_TESTAR !== undefined)      { await cmdTestar(CMD_TESTAR === true ? null : CMD_TESTAR);           process.exit(0); }
  if (CMD_CONECTAR !== undefined)    { await cmdConectar(CMD_CONECTAR === true ? null : CMD_CONECTAR);     process.exit(0); }
  if (CMD_DESCONECTAR !== undefined) { await cmdDesconectar(CMD_DESCONECTAR === true ? null : CMD_DESCONECTAR); process.exit(0); }

  if (MODO_ARG !== undefined && MODO_ARG !== 'paralelo' && MODO_ARG !== 'sequencial') {
    console.error(red(`❌ --modo deve ser "sequencial" ou "paralelo" (recebido: ${MODO_ARG})`));
    process.exit(1);
  }

  if (CONTINUO) { await modoContinuo(); process.exit(0); }

  if (!csvArg) {
    console.log(cyan(`ℹ️  Usando lista padrão: ${path.relative(DIR, csvPath)}\n`));
  }

  if (DRY_RUN) console.log(yellow('⚠️  MODO DRY-RUN — nenhuma mensagem será enviada\n'));
  console.log(green('⚡ Envio liberado a qualquer horário (respeitando apenas a janela de 24h por telefone)\n'));

  const cfg = lerConfig();
  await rodarLote({ csvPath, cfg, continuo: false, confirmar: !DRY_RUN && !AUTO_YES });
  process.exit(0);
}

main().catch(err => {
  logErro('erro_fatal', err);
  logHora(red(`💥 Erro fatal: ${err.message}`));
  console.error(err.stack);
  process.exit(1);
});