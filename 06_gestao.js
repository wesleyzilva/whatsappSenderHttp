#!/usr/bin/env node
'use strict';
/**
 * 06_gestao.js — visão de operação (secretária) e de gestão (TPM). Somente leitura, exceto
 * --retentar-falhas e --convite-grupo, que gravam arquivos e pedem confirmação.
 *
 *   node 06_gestao.js --hoje                       o que fazer agora (checklist da secretária)
 *   node 06_gestao.js --fechamento [csv]           a campanha terminou? 100% enviada? pode ir para a próxima?
 *   node 06_gestao.js --gestao [--dias=14]         relatório de gestão (KPIs, perdas, riscos, recomendações)
 *   node 06_gestao.js --csvs[=N]                   lista de campanhas em JSON (usada pelo menu e pelo painel)
 *   node 06_gestao.js --retentar-falhas [csv]      devolve à fila os contatos que falharam
 *   node 06_gestao.js --convite-grupo --link=URL [--de=csv] [--ddd=46]
 *                                                  gera a lista do convite para o grupo de promoções
 */
const fs       = require('fs');
const path     = require('path');
const readline = require('readline');
const { parse } = require('csv-parse/sync');
const core     = require('./02a_zap_core');

const DIR        = __dirname;
const LOG_DIR    = path.join(DIR, '03_log');
const SENT_LOG   = path.join(LOG_DIR, 'sent_log.json');
const DISPAROS   = path.join(DIR, '02_disparos');
const BLACKLIST  = path.join(DIR, '01_fontes', 'blacklist.txt');
const MSG_GRUPO  = path.join(DIR, '01_fontes', 'mensagem_grupo_harmonizacao.txt');

// ── Formatação ───────────────────────────────────────────────────────────────
const c = (code, t) => `\x1b[${code}m${t}\x1b[0m`;
const green = t => c(32, t), red = t => c(31, t), yellow = t => c(33, t), cyan = t => c(36, t), bold = t => c(1, t), dim = t => c(90, t);
const pad2 = n => String(n).padStart(2, '0');
const fmtDH = ms => (ms && Number.isFinite(ms)) ? core.dataHoraLocal(new Date(ms)).slice(0, 16) : 'nunca';
const fmtDia = d => `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`;
const pct = (n, t) => (t ? Math.round((n / t) * 100) : 0);
const barra = (n, t, w = 20) => { const f = t ? Math.round((n / t) * w) : 0; return '█'.repeat(f) + '░'.repeat(w - f); };
const stripAnsi = s => String(s).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');

function titulo(txt) {
  const l = txt.length + 4;
  console.log('\n╔' + '═'.repeat(l) + '╗\n║  ' + bold(txt) + '  ║\n╚' + '═'.repeat(l) + '╝\n');
}

function perguntar(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => rl.question(q, a => { rl.close(); res(a.trim()); }));
}

// ── Dados base ───────────────────────────────────────────────────────────────
function lerSentLog() {
  try { return JSON.parse(fs.readFileSync(SENT_LOG, 'utf8')); } catch { return {}; }
}

/** Mês local (YYYYMM). Mesmo critério do 01_gerar_lista.py (date.today()). */
function mesLocal(d = new Date()) { return `${d.getFullYear()}${pad2(d.getMonth() + 1)}`; }

function mesDoArquivo(nome) {
  const m = String(nome).match(/_(\d{4})(\d{2})\d{2}\.csv$/i);
  return m ? `${m[1]}${m[2]}` : null;
}

function dataDoArquivo(nome) {
  const m = String(nome).match(/_(\d{4})(\d{2})(\d{2})\.csv$/i);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '?';
}

function metaDoArquivo(nome) {
  let m = String(nome).match(/^lista_(.+)_([A-Z]{1,5})_(\d{8})\.csv$/);
  if (m) return { campanha: m[1], segmento: m[2] };
  m = String(nome).match(/^lista_disparos_([A-Z]{1,5})_(\d{8})\.csv$/);
  if (m) return { campanha: 'legado', segmento: m[1] };
  return { campanha: '?', segmento: '?' };
}

const soDigitos = n => String(n || '').replace(/\D/g, '');

/** Telefone sem DDI (55) para comparar CSV x blacklist. */
function semDDI(n) {
  const d = soDigitos(n);
  return d.startsWith('55') && d.length > 11 ? d.slice(2) : d;
}

function carregarBlacklist() {
  const set = new Set();
  try {
    for (const linha of fs.readFileSync(BLACKLIST, 'utf8').split(/\r?\n/)) {
      const t = linha.trim();
      if (!t || t.startsWith('#')) continue;
      const d = semDDI(t);
      if (d.length >= 8) set.add(d);
    }
  } catch { /* sem blacklist ainda */ }
  return set;
}

/** Mesma regra de deduplicação do 02_sender.js (numero + categoria, vence a maior pontuação). */
function carregarCsv(filePath) {
  let raw = fs.readFileSync(filePath, 'utf8');
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
  const linhas = raw.split('\n');
  const idx = linhas.findIndex(l => l.trimStart().startsWith('pontuacao,'));
  if (idx > 0) raw = linhas.slice(idx).join('\n');
  const records = parse(raw, { columns: true, skip_empty_lines: true, relax_quotes: true, trim: true, relax_column_count: true });
  const mapa = new Map();
  for (const row of records) {
    if (!row.numero || !row.mensagem) continue;
    const key = `${soDigitos(row.numero)}_${row.categoria}`;
    const ex = mapa.get(key);
    if (!ex || Number(row.pontuacao) > Number(ex.pontuacao)) mapa.set(key, row);
  }
  return { records: [...mapa.values()], colunas: records.length ? Object.keys(records[0]) : [], registrosBrutos: records.length };
}

function categoriaDoErro(msg) {
  const s = String(msg || '');
  if (/detached Frame|Target closed|Session closed|Execution context|Protocol error|Browser has disconnected|Page crashed/i.test(s)) return 'Navegador travou durante o envio (a mensagem PODE ter sido entregue)';
  if (/timed out|Timeout/i.test(s)) return 'Tempo esgotado no WhatsApp Web';
  if (/getChat|undefined|null/i.test(s)) return 'Falha interna da biblioteca (atualizar menu [16])';
  if (/LOGOUT|QR|auth/i.test(s)) return 'Sessão do zap caiu (reler QR)';
  return 'Outro motivo';
}

// ── Zaps ─────────────────────────────────────────────────────────────────────
function infoZaps(cfg, sentLog) {
  const estado = core.lerEstado();
  const ef = core.limiteEfetivo(cfg);
  const agora = Date.now();
  return cfg.chips.map((ch, i) => {
    const st = estado[ch.id] || {};
    const numero = core.obterNumeroChip(ch, estado, sentLog);
    const ts = core.timestampsJanela(ch.id, sentLog, cfg, agora, numero);
    const bloqueadoAte = st.bloqueadoAte && Date.parse(st.bloqueadoAte) > agora ? st.bloqueadoAte : null;
    const sessao = core.sessaoExiste(ch.id);
    const precisaQR = !!st.precisaQR;
    const ativo = ch.ativo !== false;
    const pronto = ativo && sessao && !precisaQR && !bloqueadoAte;
    return {
      idx: i + 1, id: ch.id, apelido: ch.apelido, ativo, numero,
      rotulo: core.identificadorZap({ id: ch.id, apelido: ch.apelido, numero }),
      sessao, precisaQR, bloqueadoAte, pronto,
      enviados24h: ts.length, cap: ef, vagas: Math.max(0, ef - ts.length),
      liberaEm: ts.length >= ef ? core.quandoTemVagas(ch.id, 1, sentLog, cfg, agora, numero) : null,
      ultimoEnvioMs: core.ultimoEnvioChip(ch.id, sentLog, numero),
      ultimoErro: st.ultimoErro || null,
      falhasConexao: st.falhasConexao || 0,
    };
  });
}

function situacaoZap(z) {
  if (!z.ativo) return { txt: 'desativado', nivel: 'off' };
  if (z.bloqueadoAte) return { txt: `pausado até ${fmtDH(Date.parse(z.bloqueadoAte))}`, nivel: 'erro' };
  if (z.precisaQR) return { txt: 'precisa ler o QR de novo', nivel: 'erro' };
  if (!z.sessao) return { txt: z.numero ? 'desconectado (ler QR)' : 'vazio — nunca conectado', nivel: 'aviso' };
  return { txt: 'conectado', nivel: 'ok' };
}

/** Quantas mensagens por dia os zaps prontos conseguem enviar (teto de 24h × zaps prontos). */
function capacidadeDiaria(zaps) {
  return zaps.filter(z => z.pronto).length * (zaps[0] ? zaps[0].cap : 0);
}

// ── Análise de campanha (CSV × sent_log) ─────────────────────────────────────
function analisarCampanha(csvPath, { mes, sentLog, blacklist, zaps } = {}) {
  const nome = path.basename(csvPath);
  const log = sentLog || lerSentLog();
  const bl = blacklist || carregarBlacklist();
  const mesRef = mes || mesDoArquivo(nome) || mesLocal();
  const st = fs.statSync(csvPath);
  const meta = metaDoArquivo(nome);
  const base = {
    arquivo: nome, campanha: meta.campanha, segmento: meta.segmento, dataArquivo: dataDoArquivo(nome),
    mesRef, idadeH: Math.floor((Date.now() - st.mtimeMs) / 3_600_000), mtimeMs: st.mtimeMs, tamanhoKB: Math.round(st.size / 1024),
  };
  let carregado;
  try { carregado = carregarCsv(csvPath); } catch (e) { return { ...base, unicos: 0, status: 'vazio', veredito: `CSV ilegível: ${e.message}`, proximoPasso: 'Gere a lista novamente (menu [3]).' }; }

  const porNumero = new Map();
  for (const r of carregado.records) { const n = soDigitos(r.numero); if (!porNumero.has(n)) porNumero.set(n, r); }
  const a = { enviados: 0, semWhatsapp: 0, falhas: 0, pendentes: 0, blacklist: 0, bloqueadosMes: 0 };
  const causas = {};
  let primeiro = Infinity, ultimo = 0;
  const dias = new Set();
  for (const [n, r] of porNumero) {
    const e = log[`${n}_${mesRef}`];
    if (e && e.categoria && r.categoria && e.categoria !== r.categoria) { a.bloqueadosMes++; continue; }
    if (e) {
      const t = Date.parse(e.sentAt || '');
      if (Number.isFinite(t)) { primeiro = Math.min(primeiro, t); ultimo = Math.max(ultimo, t); dias.add(core.diaLocal(new Date(t))); }
    }
    if (e && e.status === 'sent') a.enviados++;
    else if (e && e.status === 'skipped_not_registered') a.semWhatsapp++;
    else if (e && e.status === 'failed') { a.falhas++; const k = categoriaDoErro(e.error); causas[k] = (causas[k] || 0) + 1; }
    else if (bl.has(semDDI(n))) a.blacklist++;
    else a.pendentes++;
  }
  const unicos = porNumero.size;
  const processados = a.enviados + a.semWhatsapp + a.falhas;
  const res = {
    ...base, ...a, unicos, linhasNoArquivo: carregado.registrosBrutos, processados, falhasPorCausa: causas,
    pctProcessado: pct(processados, unicos), pctEntregue: pct(a.enviados, unicos),
    inicioMs: Number.isFinite(primeiro) ? primeiro : null, fimMs: ultimo || null, diasComEnvio: dias.size,
  };

  const capDia = zaps ? capacidadeDiaria(zaps) : 0;
  if (unicos === 0) {
    res.status = 'vazio'; res.veredito = 'Arquivo vazio';
    res.proximoPasso = 'Nada a enviar: gere uma nova lista (menu [3]).';
  } else if (a.bloqueadosMes > 0 && processados === 0 && a.pendentes === 0) {
    res.status = 'aguardando_mes'; res.veredito = 'AGUARDANDO VIRADA DO MÊS — todos já receberam outra mensagem neste mês';
    res.proximoPasso = 'Regra de 1 mensagem por telefone/mês: esta lista só poderá ser enviada a partir do dia 1 do próximo mês.';
  } else if (processados === 0 && a.pendentes > 0) {
    res.status = 'nao_iniciada'; res.veredito = 'NÃO INICIADA';
    res.proximoPasso = 'Faça um dry-run (menu [6]) e depois envie ([5] ou [17] modo contínuo).';
  } else if (a.pendentes > 0) {
    res.status = 'em_andamento'; res.veredito = `EM ANDAMENTO — ${res.pctProcessado}% processada`;
    const dias2 = capDia > 0 ? Math.ceil(a.pendentes / capDia) : null;
    res.previsaoDias = dias2;
    res.proximoPasso = capDia > 0
      ? `Faltam ${a.pendentes} contatos. Com ${zaps.filter(z => z.pronto).length} zap(s) pronto(s) (${capDia}/dia) termina em ~${dias2} dia(s).`
      : `Faltam ${a.pendentes} contatos e NENHUM zap está pronto — conecte um zap (menu [13]).`;
  } else if (a.falhas === 0) {
    res.status = 'concluida'; res.veredito = 'CONCLUÍDA — 100% dos contatos foram processados, sem falhas';
    res.proximoPasso = 'Pode seguir para a próxima campanha: gere a nova lista (menu [3]).';
  } else {
    res.status = 'concluida_com_ressalvas';
    res.veredito = `CONCLUÍDA COM RESSALVAS — todos processados, mas ${a.falhas} falharam (${pct(a.falhas, unicos)}%)`;
    res.proximoPasso = `Decida: retentar as ${a.falhas} falhas (menu [20]) ou aceitar a perda e seguir para a próxima campanha. `
      + 'Atenção: falhas de "navegador travou" podem ter entregue a mensagem; retentar pode duplicar.';
  }
  return res;
}

function imprimirFechamento(a, { compacto = false } = {}) {
  if (!compacto) titulo('FECHAMENTO DA CAMPANHA');
  const cor = a.status === 'concluida' ? green : a.status === 'concluida_com_ressalvas' ? yellow : a.status === 'em_andamento' ? cyan : a.status === 'aguardando_mes' ? yellow : dim;
  console.log(`  Arquivo     : ${bold(a.arquivo)}  ${dim(`(campanha ${a.campanha} · segmento ${a.segmento} · gerado ${a.dataArquivo})`)}`);
  console.log(`  Situação    : ${cor(bold(a.veredito))}`);
  if (a.unicos > 0) {
    console.log(`  Progresso   : [${green(barra(a.processados, a.unicos))}] ${a.pctProcessado}% processado  ·  ${a.pctEntregue}% entregue de fato`);
    console.log(`  Contatos    : ${bold(String(a.unicos))} únicos${a.linhasNoArquivo !== a.unicos ? dim(` (${a.linhasNoArquivo} linhas no arquivo, após deduplicar)`) : ''}`);
    console.log(`    ${green('✅ Enviados')}            : ${a.enviados}`);
    console.log(`    ${yellow('⚠️  Sem WhatsApp')}       : ${a.semWhatsapp}`);
    console.log(`    ${red('❌ Falharam')}           : ${a.falhas}`);
    console.log(`    ⏳ Pendentes           : ${a.pendentes}`);
    if (a.bloqueadosMes) console.log(`    📅 Já receberam outra mensagem neste mês (aguardam o mês virar): ${a.bloqueadosMes}`);
    if (a.blacklist) console.log(`    🚫 Na blacklist (não enviar): ${a.blacklist}`);
    for (const [k, v] of Object.entries(a.falhasPorCausa || {})) console.log(`       ↳ ${v}× ${k}`);
    if (a.inicioMs) console.log(`  Período     : ${fmtDH(a.inicioMs)} → ${fmtDH(a.fimMs)}  (${a.diasComEnvio} dia(s) com envio)`);
  }
  console.log(`  ${bold('Próximo passo')}: ${a.proximoPasso}\n`);
}

function arquivosCsv() {
  if (!fs.existsSync(DISPAROS)) return [];
  return fs.readdirSync(DISPAROS).filter(f => /\.csv$/i.test(f)).map(f => {
    const p = path.join(DISPAROS, f);
    return { f, p, t: fs.statSync(p).mtimeMs, d: (f.match(/_(\d{8})\.csv$/) || [0, '0'])[1] };
  }).sort((x, y) => (y.t - x.t) || y.d.localeCompare(x.d));
}

function listarCampanhas(limite) {
  const cfg = core.lerConfig();
  const log = lerSentLog();
  const bl = carregarBlacklist();
  const zaps = infoZaps(cfg, log);
  const lista = arquivosCsv();
  return (limite ? lista.slice(0, limite) : lista).map(x => analisarCampanha(x.p, { sentLog: log, blacklist: bl, zaps }));
}

// ── Ações necessárias (secretária) ───────────────────────────────────────────
function lerJsonl(prefixo, dias) {
  if (!fs.existsSync(core.ERR_DIR)) return [];
  const limite = Date.now() - dias * 86_400_000;
  const re = new RegExp(`^${prefixo}_\\d{4}-\\d{2}-\\d{2}\\.jsonl$`);
  const out = [];
  for (const f of fs.readdirSync(core.ERR_DIR).filter(x => re.test(x)).sort()) {
    for (const l of fs.readFileSync(path.join(core.ERR_DIR, f), 'utf8').split('\n')) {
      if (!l.trim()) continue;
      try { const r = JSON.parse(l); if (Date.parse(r.ts) >= limite) out.push(r); } catch { /* linha parcial */ }
    }
  }
  return out;
}

function acoesNecessarias() {
  const cfg = core.lerConfig();
  const log = lerSentLog();
  const zaps = infoZaps(cfg, log);
  const bl = carregarBlacklist();
  const acoes = [];
  const add = (nivel, texto, acao) => acoes.push({ nivel, texto, acao });

  const ativos = zaps.filter(z => z.ativo);
  const prontos = ativos.filter(z => z.pronto);
  const comVaga = prontos.filter(z => z.vagas > 0);
  for (const z of ativos.filter(z => z.precisaQR || (!z.sessao && z.numero))) add('alta', `${z.rotulo} perdeu a conexão e precisa ler o QR de novo.`, 'Menu [13] ou botão "Conectar (QR)" no painel; ou desative este zap se não for usar.');
  for (const z of ativos.filter(z => z.bloqueadoAte)) add('alta', `${z.rotulo} está pausado até ${fmtDH(Date.parse(z.bloqueadoAte))} (limite do WhatsApp ou falhas seguidas).`, 'Não force: aguarde a pausa terminar.');
  for (const z of ativos.filter(z => !z.sessao && !z.precisaQR && !z.numero)) add('info', `${z.rotulo} é um slot vazio (nunca foi conectado).`, 'Só conecte se for usar; senão desative para não poluir os relatórios.');
  if (prontos.length === 0) add('alta', 'Nenhum zap está pronto para enviar.', 'Conecte pelo menos um zap (menu [13]).');
  else if (comVaga.length === 0) {
    const prox = Math.min(...prontos.map(z => z.liberaEm || Infinity));
    add('info', `Todos os zaps prontos atingiram o teto de ${prontos[0].cap} envios em 24h.`, Number.isFinite(prox) ? `Próxima vaga abre em ${fmtDH(prox)}. Nada a fazer até lá.` : 'Aguarde a janela de 24h.');
  }

  const csvs = arquivosCsv();
  let campanha = null;
  if (csvs.length) {
    campanha = analisarCampanha(csvs[0].p, { sentLog: log, blacklist: bl, zaps });
    if (campanha.status === 'concluida') add('media', `Campanha ${campanha.arquivo} está 100% concluída.`, 'Gere a próxima lista (menu [3]) e confira se o modo contínuo já encerrou.');
    else if (campanha.status === 'concluida_com_ressalvas') add('media', `Campanha ${campanha.arquivo} terminou, mas ${campanha.falhas} contatos falharam.`, 'Veja o fechamento (menu [19]) e decida: retentar (menu [20]) ou seguir adiante.');
    else if (campanha.status === 'em_andamento' && comVaga.length) add('info', `Campanha ${campanha.arquivo}: faltam ${campanha.pendentes} contatos e há ${comVaga.reduce((s, z) => s + z.vagas, 0)} vagas livres agora.`, 'Inicie/mantenha o modo contínuo (menu [17] ou painel).');
    const mArq = mesDoArquivo(campanha.arquivo);
    if (mArq && mArq < mesLocal() && campanha.status !== 'vazio') add('media', `A lista mais recente (${campanha.dataArquivo}) é de um mês anterior.`, 'Gere uma lista nova (menu [3]); o modo contínuo recusa listas antigas para não reenviar para quem já recebeu.');
  } else add('media', 'Não há nenhuma lista em 02_disparos.', 'Gere uma lista (menu [3]).');

  const semWhats = new Set(Object.values(log).filter(e => e.status === 'skipped_not_registered').map(e => semDDI(e.numero)));
  const naoExportados = [...semWhats].filter(n => !bl.has(n)).length;
  if (naoExportados > 0) add('info', `${naoExportados} número(s) sem WhatsApp ainda não estão na blacklist (vão ser tentados de novo no mês que vem).`, 'Menu [10] exporta todos para a blacklist.');

  const erros24 = lerJsonl('erros', 1);
  if (erros24.length >= 10) add('media', `${erros24.length} erros registrados nas últimas 24h.`, 'Menu [15] mostra os erros; avise o responsável técnico se continuarem.');

  const ordem = { alta: 0, media: 1, info: 2 };
  acoes.sort((x, y) => ordem[x.nivel] - ordem[y.nivel]);
  return { acoes, zaps, campanha };
}

function cmdHoje() {
  titulo('O QUE FAZER AGORA');
  const { acoes, zaps, campanha } = acoesNecessarias();
  console.log(`  ${bold('Data')}: ${core.dataHoraLocal().slice(0, 16)}\n`);
  console.log(bold('  Zaps (números de envio):'));
  for (const z of zaps) {
    const s = situacaoZap(z);
    const f = s.nivel === 'ok' ? green : s.nivel === 'erro' ? red : s.nivel === 'aviso' ? yellow : dim;
    console.log(`    [${z.idx}] ${cyan(z.rotulo.padEnd(34))} ${f(s.txt.padEnd(28))} 24h: ${z.enviados24h}/${z.cap}${z.liberaEm ? dim(` · vaga em ${fmtDH(z.liberaEm)}`) : ''}`);
  }
  console.log(`\n  Capacidade imediata: ${bold(String(zaps.filter(z => z.pronto).reduce((s, z) => s + z.vagas, 0)))} mensagens agora · ${bold(String(capacidadeDiaria(zaps)))}/dia com os zaps atuais\n`);
  if (campanha) { console.log(bold('  Campanha mais recente:')); imprimirFechamento(campanha, { compacto: true }); }
  console.log(bold('  Lista de tarefas:'));
  if (!acoes.length) console.log(green('    ✅ Nada pendente. Operação saudável.'));
  const icone = { alta: red('🔴 URGENTE'), media: yellow('🟡 ATENÇÃO '), info: cyan('🔵 INFO    ') };
  for (const x of acoes) console.log(`    ${icone[x.nivel]}  ${x.texto}\n                 ${dim('→ ' + x.acao)}`);
  console.log('');
}

// ── Relatório de gestão (TPM) ────────────────────────────────────────────────
function relatorioGestao(dias = 14) {
  const cfg = core.lerConfig();
  const log = lerSentLog();
  const zaps = infoZaps(cfg, log);
  const bl = carregarBlacklist();
  const eventos = lerJsonl('eventos', dias);
  const erros = lerJsonl('erros', dias);
  const L = [];
  const h = t => L.push('', `## ${t}`, '');
  const hoje = new Date();
  L.push(`# Relatório de gestão — ${fmtDia(hoje)}/${hoje.getFullYear()} (últimos ${dias} dias)`);

  const csvs = arquivosCsv();
  const camp = csvs.length ? analisarCampanha(csvs[0].p, { sentLog: log, blacklist: bl, zaps }) : null;

  h('1. Resumo executivo');
  if (camp) {
    L.push(`- Campanha ativa: **${camp.arquivo}** — ${camp.veredito}.`);
    L.push(`- Funil: ${camp.unicos} contatos únicos → ${camp.enviados} enviados (${camp.pctEntregue}%), ${camp.semWhatsapp} sem WhatsApp, ${camp.falhas} falhas, ${camp.pendentes} pendentes.`);
    if (camp.inicioMs) {
      const dur = Math.max(1, Math.round(((camp.fimMs || Date.now()) - camp.inicioMs) / 86_400_000));
      L.push(`- Lead time: ${fmtDH(camp.inicioMs)} → ${fmtDH(camp.fimMs)} = ${dur} dia(s) corridos, com envio em apenas ${camp.diasComEnvio} deles (${pct(camp.diasComEnvio, dur)}% de dias ativos).`);
    }
    L.push(`- Próximo passo: ${camp.proximoPasso}`);
  } else L.push('- Nenhuma lista encontrada em 02_disparos.');
  const prontos = zaps.filter(z => z.pronto);
  L.push(`- Zaps: ${prontos.length} pronto(s) de ${zaps.filter(z => z.ativo).length} ativo(s) (${zaps.length} cadastrados) · capacidade ${capacidadeDiaria(zaps)}/dia.`);

  h('2. Vazão (envios por dia)');
  const porDia = {};
  for (const e of Object.values(log)) {
    if (e.status !== 'sent') continue;
    const t = Date.parse(e.sentAt || '');
    if (!Number.isFinite(t) || t < Date.now() - dias * 86_400_000) continue;
    const d = core.diaLocal(new Date(t));
    porDia[d] = (porDia[d] || 0) + 1;
  }
  const capPotencial = Math.max(zaps.filter(z => z.ativo && z.numero).length * (zaps[0] ? zaps[0].cap : 0), 1);
  const maxDia = Math.max(1, ...Object.values(porDia));
  L.push('| Dia | Enviados | Gráfico |', '|---|---:|---|');
  let totalPeriodo = 0, diasAtivos = 0;
  for (let i = dias - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000);
    const n = porDia[core.diaLocal(d)] || 0;
    totalPeriodo += n; if (n) diasAtivos++;
    L.push(`| ${fmtDia(d)} | ${n} | ${'█'.repeat(Math.round((n / maxDia) * 20))} |`);
  }
  L.push('', `- Total no período: **${totalPeriodo}** · dias com envio: **${diasAtivos}/${dias}** · média nos dias ativos: **${diasAtivos ? Math.round(totalPeriodo / diasAtivos) : 0}**/dia.`);
  L.push(`- Capacidade potencial (zaps com número configurado × teto de 24h): **${capPotencial}/dia** · utilização média no período: **${pct(totalPeriodo / dias, capPotencial)}%**.`);

  h('3. Saúde dos zaps');
  L.push('| Zap | Situação | Enviados 24h | Último envio | Falhas de conexão (período) | Quedas de sessão |', '|---|---|---:|---|---:|---:|');
  for (const z of zaps) {
    const falhas = erros.filter(e => e.evento === 'conexao_falhou' && e.chip === z.id).length;
    const quedas = erros.filter(e => e.evento === 'desconectado' && e.chip === z.id).length;
    L.push(`| ${z.rotulo} | ${situacaoZap(z).txt} | ${z.enviados24h}/${z.cap} | ${fmtDH(z.ultimoEnvioMs)} | ${falhas} | ${quedas} |`);
  }

  h('4. Desperdício e perdas');
  const fins = eventos.filter(e => e.evento === 'run_fim');
  const vazios = fins.filter(e => e.sent === 0 && e.total > 0);
  const segVazios = vazios.reduce((s, e) => s + (e.duracaoSeg || 0), 0);
  const offline = eventos.filter(e => e.evento === 'internet_voltou').reduce((s, e) => s + (e.offline_s || 0), 0);
  L.push(`- Lotes executados: **${fins.length}** · lotes que terminaram com **0 envios**: **${vazios.length}** (${Math.round(segVazios / 60)} min de execução sem resultado).`);
  L.push(`- Tempo sem internet detectado: **${(offline / 3600).toFixed(1)} h**.`);
  const porEvento = {};
  for (const e of erros) { const k = `${e.tipo} · ${e.evento}`; porEvento[k] = (porEvento[k] || 0) + 1; }
  const top = Object.entries(porEvento).sort((x, y) => y[1] - x[1]).slice(0, 8);
  if (top.length) { L.push('', '| Erros mais frequentes | Qtde |', '|---|---:|', ...top.map(([k, v]) => `| ${k} | ${v} |`)); }
  const socket = erros.filter(e => /reading 'Socket'/.test(e.mensagem || ''));
  if (socket.length) {
    const quem = [...new Set(socket.map(e => e.chip))].join(', ');
    L.push('', `- **Causa raiz recorrente:** ${socket.length}× "reading 'Socket'" (sessão corrompida) no(s) zap(s) ${quem}. Cada tentativa gasta ~15 s e, em modo contínuo, repetia a cada hora sem enviar nada. A ação correta é reler o QR (ou desativar o zap), não insistir.`);
  }

  h('5. Qualidade dos dados e da entrega');
  const totais = { sent: 0, failed: 0, skipped_not_registered: 0 };
  for (const e of Object.values(log)) if (totais[e.status] !== undefined) totais[e.status]++;
  const totalLog = totais.sent + totais.failed + totais.skipped_not_registered;
  L.push(`- Histórico completo: ${totalLog} registros → ${totais.sent} enviados (${pct(totais.sent, totalLog)}%), ${totais.skipped_not_registered} sem WhatsApp (${pct(totais.skipped_not_registered, totalLog)}%), ${totais.failed} falhas (${pct(totais.failed, totalLog)}%).`);
  if (camp && camp.falhas) { L.push(`- Falhas da campanha ativa por causa:`); for (const [k, v] of Object.entries(camp.falhasPorCausa)) L.push(`  - ${v}× ${k}`); }
  L.push(`- Blacklist: **${bl.size}** número(s) cadastrado(s).`);

  h('6. Riscos e recomendações (priorizadas)');
  const recs = [];
  if (!bl.size) recs.push(['P1', 'A blacklist está vazia: nenhum pedido de saída foi registrado até hoje.', 'Confirme se há respostas "SAIR"/"não quero" nos zaps e registre cada uma no arquivo 01_fontes/blacklist.txt no mesmo dia.']);
  if (camp) {
    try {
      const msg = (carregarCsv(path.join(DISPAROS, camp.arquivo)).records[0] || {}).mensagem || '';
      if (!/\bsair\b|n[aã]o (quer|deseja)|parar de receber|descadastr/i.test(msg)) recs.push(['P1', `A mensagem da campanha ${camp.arquivo} não oferece forma de sair da lista.`, 'Acrescentar "Responda SAIR para não receber mais mensagens" e usar o convite para o grupo de promoções (menu [22]) como canal opt-in.']);
    } catch { /* CSV ilegível já aparece no fechamento */ }
  }
  if (vazios.length) recs.push(['P1', `${vazios.length} lote(s) terminaram sem nenhum envio (${Math.round(segVazios / 60)} min de execução).`, 'Costuma ser zap com sessão corrompida sendo tentado em loop. O sistema agora põe o zap em quarentena após 2 falhas seguidas de conexão; releia o QR ou desative o zap.']);
  const semQR = zaps.filter(z => z.ativo && z.numero && !z.pronto);
  if (semQR.length) recs.push(['P1', `${semQR.length} zap(s) com número configurado sem conexão válida (${semQR.map(z => z.rotulo).join('; ')}) — capacidade ociosa de ${semQR.length * (zaps[0] ? zaps[0].cap : 0)} envios/dia.`, 'Reler o QR dos que serão usados e desativar os demais.']);
  if (camp && camp.falhas) recs.push(['P2', `${camp.falhas} falha(s) na campanha ativa sem retentativa.`, 'Menu [20] devolve as falhas à fila; avalie o risco de duplicidade antes.']);
  if (diasAtivos < Math.min(dias, 7)) recs.push(['P2', 'Poucos dias com envio no período: a operação depende de alguém manter o modo contínuo aberto no PC.', 'Rodar o painel/modo contínuo em máquina dedicada (ou tarefa agendada) e seguir o checklist diário.']);
  if (!recs.length) recs.push(['—', 'Nenhum risco operacional detectado nos dados do período.', 'Manter a rotina diária.']);
  L.push('| Prioridade | Risco / achado | Ação recomendada |', '|---|---|---|', ...recs.map(r => `| ${r[0]} | ${r[1]} | ${r[2]} |`));
  L.push('');
  return L.join('\n');
}

function cmdGestao(dias) {
  const md = relatorioGestao(dias);
  console.log('\n' + md);
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const arq = path.join(LOG_DIR, `relatorio_gestao_${core.diaLocal()}.md`);
    fs.writeFileSync(arq, md, 'utf8');
    console.log(dim(`\n  (salvo em ${path.relative(DIR, arq)})\n`));
  } catch { /* só exibe */ }
}

// ── Retentar falhas ──────────────────────────────────────────────────────────
async function cmdRetentarFalhas(csvPath, { sim = false } = {}) {
  titulo('RETENTAR FALHAS');
  const mes = mesLocal();
  const log = lerSentLog();
  const { records } = carregarCsv(csvPath);
  const chaves = [];
  for (const r of records) {
    const k = `${soDigitos(r.numero)}_${mes}`;
    if (log[k] && log[k].status === 'failed' && !chaves.includes(k)) chaves.push(k);
  }
  console.log(`  Arquivo: ${bold(path.basename(csvPath))}`);
  if (!chaves.length) { console.log(green('  Nenhuma falha neste mês para devolver à fila.\n')); return; }
  const causas = {};
  for (const k of chaves) { const t = categoriaDoErro(log[k].error); causas[t] = (causas[t] || 0) + 1; }
  console.log(`  ${red(String(chaves.length))} contato(s) com falha serão devolvidos à fila:`);
  for (const [k, v] of Object.entries(causas)) console.log(`    ↳ ${v}× ${k}`);
  console.log(yellow('\n  Atenção: se a falha foi "navegador travou", a mensagem pode já ter sido entregue — o contato poderá receber duas vezes.'));
  if (!sim) {
    const ans = await perguntar('\n  Confirma devolver à fila? (s/N) ');
    if (ans.toLowerCase() !== 's') { console.log('  Cancelado.\n'); return; }
  }
  fs.mkdirSync(path.join(LOG_DIR, 'backup'), { recursive: true });
  const bkp = path.join(LOG_DIR, 'backup', `sent_log_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.copyFileSync(SENT_LOG, bkp);
  for (const k of chaves) delete log[k];
  fs.writeFileSync(SENT_LOG, JSON.stringify(log, null, 2), 'utf8');
  console.log(green(`\n  ✅ ${chaves.length} contato(s) voltaram para a fila. Backup do log: ${path.relative(DIR, bkp)}`));
  console.log('  Agora rode o envio normalmente (menu [5] ou [17]).\n');
}

// ── Convite para o grupo de promoções ────────────────────────────────────────
const LINK_RE = /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9_-]{10,}$/;
const csvCampo = v => `"${String(v === undefined || v === null ? '' : v).replace(/"/g, '""')}"`;

function cmdConviteGrupo({ link, de, ddd }) {
  titulo('CONVITE PARA O GRUPO DE PROMOÇÕES');
  if (!link || !LINK_RE.test(link)) {
    console.log(red('  Informe o link de convite do grupo: --link=https://chat.whatsapp.com/XXXXXXXXXXXX'));
    console.log(dim('  (No WhatsApp: abra o grupo › Convidar via link › Copiar link.)\n'));
    process.exitCode = 1; return;
  }
  if (!fs.existsSync(MSG_GRUPO)) { console.log(red(`  Modelo de mensagem não encontrado: ${path.relative(DIR, MSG_GRUPO)}\n`)); process.exitCode = 1; return; }
  const modelo = fs.readFileSync(MSG_GRUPO, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => !l.startsWith('#')).join('\n').trim();
  if (!modelo.includes('{LINK_GRUPO}')) { console.log(red('  O modelo precisa conter {LINK_GRUPO}.\n')); process.exitCode = 1; return; }
  const mensagem = modelo.replace(/\{LINK_GRUPO\}/g, link);

  const origem = de ? path.resolve(DIR, de.includes(path.sep) || de.includes('/') ? de : path.join('02_disparos', de))
    : (arquivosCsv().find(x => /patoBranco/i.test(x.f)) || {}).p;
  if (!origem || !fs.existsSync(origem)) { console.log(red('  CSV de origem não encontrado. Use --de=nome_do_arquivo.csv\n')); process.exitCode = 1; return; }

  const log = lerSentLog();
  const bl = carregarBlacklist();
  const { records, colunas } = carregarCsv(origem);
  const hoje = mesLocal();
  const vistos = new Set();
  const cont = { total: 0, semWhats: 0, blacklist: 0, jaEsteMes: 0, ddd: 0, liberados: 0 };
  const saida = [];
  for (const r of records) {
    const n = soDigitos(r.numero);
    if (vistos.has(n)) continue;
    vistos.add(n); cont.total++;
    if (ddd && (r.ddd || n.slice(0, 2)) !== ddd) { cont.ddd++; continue; }
    if (bl.has(semDDI(n))) { cont.blacklist++; continue; }
    const semWhats = Object.entries(log).some(([k, e]) => k.startsWith(`${n}_`) && e.status === 'skipped_not_registered');
    if (semWhats) { cont.semWhats++; continue; }
    if (log[`${n}_${hoje}`]) cont.jaEsteMes++; else cont.liberados++;
    saida.push({ ...r, categoria: 'conviteGrupo_PB', mensagem });
  }
  if (!saida.length) { console.log(yellow('  Nenhum contato elegível para o convite.\n')); return; }
  const stamp = new Date(); const ymd = `${stamp.getFullYear()}${pad2(stamp.getMonth() + 1)}${pad2(stamp.getDate())}`;
  const destino = path.join(DISPAROS, `lista_conviteGrupo_PB_${ymd}.csv`);
  const cols = colunas.length ? colunas : ['pontuacao', 'categoria', 'ddd', 'numero', 'nome', 'mensagem'];
  const linhas = [cols.map(csvCampo).join(',')];
  for (const r of saida) linhas.push(cols.map(k => csvCampo(r[k])).join(','));
  fs.writeFileSync(destino, '\uFEFF' + linhas.join('\n') + '\n', 'utf8');

  console.log(`  Origem            : ${path.basename(origem)} (${cont.total} contatos únicos)`);
  console.log(`  Removidos         : ${cont.semWhats} sem WhatsApp · ${cont.blacklist} na blacklist${ddd ? ` · ${cont.ddd} fora do DDD ${ddd}` : ''}`);
  console.log(`  ${green('Liberados hoje')}    : ${bold(String(cont.liberados))}`);
  console.log(`  ${yellow('Aguardam virada do mês')}: ${bold(String(cont.jaEsteMes))}  (já receberam mensagem neste mês — regra de 1 mensagem por telefone/mês)`);
  console.log(`  Arquivo gerado    : ${cyan(path.relative(DIR, destino))}\n`);
  console.log(bold('  Prévia da mensagem:\n'));
  console.log(mensagem.split('\n').map(l => '    ' + l).join('\n') + '\n');
  console.log(dim('  Próximos passos: dry-run (menu [6]) → envio (menu [5] ou [17]).\n'));
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function argVal(args, nome) {
  const a = args.find(x => x === `--${nome}` || x.startsWith(`--${nome}=`));
  if (a === undefined) return undefined;
  return a.includes('=') ? a.slice(a.indexOf('=') + 1) : true;
}

function resolverCsv(args) {
  const posicional = args.find(a => !a.startsWith('--'));
  if (posicional) return path.resolve(DIR, posicional);
  const l = arquivosCsv();
  return l.length ? l[0].p : null;
}

/** JSON só com ASCII (o PowerShell 5.1 lê a saída do node com a página de código do console). */
function jsonAscii(obj) {
  return JSON.stringify(obj).replace(/[\u007f-\uffff]/g, ch => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--hoje')) return cmdHoje();
  if (args.includes('--gestao')) return cmdGestao(parseInt(argVal(args, 'dias'), 10) || 14);
  const csvs = argVal(args, 'csvs');
  if (csvs !== undefined) { console.log(jsonAscii(listarCampanhas(csvs === true ? 0 : parseInt(csvs, 10) || 0))); return; }
  if (args.includes('--fechamento')) {
    const csv = resolverCsv(args);
    if (!csv) { console.log(red('  Nenhum CSV encontrado em 02_disparos.')); return; }
    const log = lerSentLog();
    imprimirFechamento(analisarCampanha(csv, { sentLog: log, zaps: infoZaps(core.lerConfig(), log) }));
    return;
  }
  if (args.includes('--retentar-falhas')) {
    const csv = resolverCsv(args);
    if (!csv) { console.log(red('  Nenhum CSV encontrado em 02_disparos.')); return; }
    return cmdRetentarFalhas(csv, { sim: args.includes('--yes') });
  }
  if (args.includes('--convite-grupo')) return cmdConviteGrupo({ link: argVal(args, 'link'), de: argVal(args, 'de'), ddd: argVal(args, 'ddd') });
  console.log('Uso: node 06_gestao.js --hoje | --fechamento [csv] | --gestao [--dias=14] | --csvs[=N] | --retentar-falhas [csv] | --convite-grupo --link=URL');
}

module.exports = {
  analisarCampanha, imprimirFechamento, listarCampanhas, acoesNecessarias, infoZaps, situacaoZap, capacidadeDiaria,
  carregarBlacklist, semDDI, mesLocal, mesDoArquivo, relatorioGestao, cmdRetentarFalhas, arquivosCsv, lerJsonl, stripAnsi,
};

if (require.main === module) {
  main().catch(e => { console.error(red(`Erro: ${e.message}`)); process.exit(1); });
}
