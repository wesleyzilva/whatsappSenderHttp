#!/usr/bin/env node
'use strict';
/**
 * 04_painel.js — painel de operação no navegador (só neste computador: 127.0.0.1)
 *   node 04_painel.js          → abre http://localhost:3737
 * Liga o 04_painel.html ao 02_sender.js: iniciar/parar o modo contínuo, ver zaps e saldo,
 * conectar número (QR), ativar/desativar zap, ajustar margem e horário, ver o log.
 */
const http = require('http');
const fs   = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const core = require('./02a_zap_core');

const DIR  = __dirname;
const PORT = Number(process.env.PORTA) || 3737;
const SENT = path.join(DIR, '03_log', 'sent_log.json');
const CHIPS = path.join(DIR, '05_config', 'chips.json');
const strip = s => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
const node  = (args) => spawn(process.execPath, [path.join(DIR, '02_sender.js'), ...args], { cwd: DIR, windowsHide: true });

// ── Modo contínuo (com reinício automático se cair) ──────────────────────────
let proc = null, querRodar = false, logs = [];
function addLog(s) {
  for (const l of strip(s).split(/\r?\n|\r/)) if (l.trim()) logs.push(`${new Date().toLocaleTimeString('pt-BR')}  ${l}`);
  if (logs.length > 600) logs = logs.slice(-400);
}
function lancar(args) {
  proc = node(args);
  proc.stdout.on('data', d => addLog(d.toString()));
  proc.stderr.on('data', d => addLog(d.toString()));
  proc.on('exit', code => {
    addLog(`— modo contínuo encerrado (código ${code}) —`);
    proc = null;
    if (querRodar && code !== 0) {
      addLog('O programa caiu. Reiniciando em 30 s…');
      setTimeout(() => { if (querRodar && !proc) lancar(args); }, 30_000);
    }
  });
}
function iniciar(o) {
  if (proc) return 'O modo contínuo já está rodando.';
  const a = ['--continuo', '--yes'];
  if (o.ignorarHorario) a.push('--ignorar-horario');
  if (o.modo === 'paralelo' || o.modo === 'sequencial') a.push(`--modo=${o.modo}`);
  if (/^\d{2}$/.test(String(o.ddd || ''))) a.push(`--ddd=${o.ddd}`);
  querRodar = true;
  lancar(a);
  return null;
}
function parar() {
  querRodar = false;
  if (!proc) return;
  try { proc.stdin.write('P\n'); } catch { /* */ }          // parada segura (fecha os Chromes)
  const p = proc; setTimeout(() => { try { if (proc === p) p.kill(); } catch { /* */ } }, 30_000);
}

// ── Conexão de número (QR) ───────────────────────────────────────────────────
const conn = { proc: null, txt: '', chip: null };
function conectar(id) {
  if (conn.proc) return 'Já existe uma conexão em andamento.';
  const cfg = core.lerConfig();
  const i = cfg.chips.findIndex(c => c.id === id);
  if (i < 0) return 'Zap inexistente.';
  conn.txt = ''; conn.chip = id;
  conn.proc = node([`--conectar=${i + 1}`]);
  const on = d => {
    const s = d.toString();
    if (s.includes('Escaneie o QR')) conn.txt = '';          // QR novo substitui o anterior
    conn.txt = (conn.txt + strip(s).replace(/\r/g, '\n')).slice(-8000);
  };
  conn.proc.stdout.on('data', on); conn.proc.stderr.on('data', on);
  conn.proc.on('exit', () => { conn.txt += '\n— conexão encerrada —'; conn.proc = null; });
  return null;
}

// ── Estado para a tela ───────────────────────────────────────────────────────
function estado() {
  const cfg = core.lerConfig();
  let sl = {}; try { sl = JSON.parse(fs.readFileSync(SENT, 'utf8')); } catch { /* sem log ainda */ }
  const est = core.lerEstado(), jan = core.enviadosJanelaPorChip(sl, cfg), ef = core.limiteEfetivo(cfg);
  const tot = { sent: 0, failed: 0, skipped_not_registered: 0 };
  for (const e of Object.values(sl)) if (tot[e.status] !== undefined) tot[e.status]++;
  const zaps = cfg.chips.map((c, i) => {
    const st = est[c.id] || {}, n = jan[c.id] || 0;
    return {
      id: c.id, idx: i + 1, apelido: c.apelido, ativo: c.ativo, numero: st.numero || null,
      sessao: core.sessaoExiste(c.id), precisaQR: !!st.precisaQR,
      bloqueadoAte: st.bloqueadoAte && Date.parse(st.bloqueadoAte) > Date.now() ? st.bloqueadoAte : null,
      enviados: n, cap: ef, liberaEm: n >= ef ? core.quandoTemVagas(c.id, 1, sl, cfg) : null,
    };
  });
  return {
    rodando: !!proc, zaps, tot, log: logs.slice(-200),
    cfg: {
      limite: cfg.limiteDiario, margem: cfg.margemSeguranca, ef, janelaHoras: cfg.janelaHoras,
      horarioAtivo: cfg.horario.ativo, horario: core.descreverHorario(cfg),
      dentro: core.dentroDoHorario(cfg), proxima: core.proximaAbertura(cfg),
      podeAdicionar: cfg.chips.length < core.MAX_CHIPS,
    },
  };
}

function salvarCfg(b) {
  const cfg = core.lerConfig();
  const raw = JSON.parse(fs.readFileSync(CHIPS, 'utf8').replace(/^\uFEFF/, ''));
  if (b.margem !== undefined) {
    const m = Math.floor(Number(b.margem));
    if (!Number.isFinite(m) || m < 0 || m >= cfg.limiteDiario) return 'Margem inválida.';
    raw.margemSeguranca = m;
  }
  if (b.horarioAtivo !== undefined) raw.horario = { ...(raw.horario || cfg.horario), ativo: !!b.horarioAtivo };
  if (b.zapId !== undefined) {
    const c = (raw.chips || []).find(x => x.id === b.zapId);
    if (!c) return 'Zap inexistente.';
    c.ativo = !!b.zapAtivo;
  }
  fs.writeFileSync(CHIPS, JSON.stringify(raw, null, 2), 'utf8');
  return null;
}

// ── HTTP ─────────────────────────────────────────────────────────────────────
const json = (res, obj, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
const corpo = req => new Promise(r => { let s = ''; req.on('data', d => { s += d; if (s.length > 1e5) req.destroy(); }); req.on('end', () => { try { r(JSON.parse(s || '{}')); } catch { r({}); } }); });

http.createServer(async (req, res) => {
  try {
    const url = req.url.split('?')[0];
    if (req.method === 'GET') {
      if (url === '/' || url === '/index.html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(path.join(DIR, '04_painel.html'))); }
      if (url === '/api/estado')  return json(res, estado());
      if (url === '/api/conexao') return json(res, { rodando: !!conn.proc, chip: conn.chip, txt: conn.txt });
      return json(res, { erro: 'não encontrado' }, 404);
    }
    if (req.method === 'POST') {
      if (req.headers['x-painel'] !== '1') return json(res, { erro: 'bloqueado' }, 403);   // barra requisições de outros sites
      const b = await corpo(req);
      let erro = null;
      if (url === '/api/iniciar')       erro = iniciar(b);
      else if (url === '/api/parar')    parar();
      else if (url === '/api/config')   erro = salvarCfg(b);
      else if (url === '/api/conectar') erro = conectar(String(b.id || ''));
      else if (url === '/api/cancelar-conexao') { if (conn.proc) try { conn.proc.stdin.write('\n'); } catch { /* */ } }
      else if (url === '/api/adicionar') { try { core.adicionarChip(core.lerConfig(), String(b.apelido || '')); } catch (e) { erro = e.message; } }
      else erro = 'rota desconhecida';
      return json(res, erro ? { erro } : { ok: true }, erro ? 400 : 200);
    }
    json(res, { erro: 'método não permitido' }, 405);
  } catch (e) { json(res, { erro: e.message }, 500); }
}).listen(PORT, '127.0.0.1', () => {
  const u = `http://localhost:${PORT}`;
  console.log(`Painel pronto em ${u}  (Ctrl+C para fechar)`);
  if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', u], { windowsHide: true });
});

process.on('SIGINT', () => { parar(); if (conn.proc) conn.proc.kill(); setTimeout(() => process.exit(0), 4000); });
process.on('uncaughtException', e => addLog(`Erro interno: ${e.message}`));
