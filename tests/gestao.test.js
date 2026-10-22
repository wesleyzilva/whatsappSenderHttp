'use strict';
const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

const core    = require('../02a_zap_core');
const gestao  = require('../06_gestao');

function csvTemp(numeros, categoria = 'teste') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gestao-'));
  const arq = path.join(dir, 'lista_teste_T_20261005.csv');
  const linhas = ['pontuacao,categoria,ddd,numero,nome,mensagem'];
  for (const n of numeros) linhas.push(`1,${categoria},${n.slice(0, 2)},${n},Contato,"Ola\nmensagem em duas linhas"`);
  fs.writeFileSync(arq, linhas.join('\n') + '\n', 'utf8');
  return arq;
}

const entrada = (numero, status, extra = {}) => [`${numero}_202610`, { numero, status, categoria: 'teste', sentAt: '2026-10-08T12:00:00.000Z', ...extra }];

test('CSV com mensagens multilinha conta contatos, nao linhas', () => {
  const arq = csvTemp(['4611111111', '4622222222', '4633333333']);
  const a = gestao.analisarCampanha(arq, { sentLog: {}, blacklist: new Set() });
  assert.strictEqual(a.unicos, 3);
  assert.strictEqual(a.pendentes, 3);
  assert.strictEqual(a.status, 'nao_iniciada');
});

test('100% processado com falhas NAO e 100% concluida', () => {
  const arq = csvTemp(['4611111111', '4622222222', '4633333333']);
  const log = Object.fromEntries([
    entrada('4611111111', 'sent'),
    entrada('4622222222', 'skipped_not_registered'),
    entrada('4633333333', 'failed', { error: "Attempted to use detached Frame 'X'." }),
  ]);
  const a = gestao.analisarCampanha(arq, { sentLog: log, blacklist: new Set() });
  assert.strictEqual(a.pctProcessado, 100);
  assert.strictEqual(a.status, 'concluida_com_ressalvas');
  assert.strictEqual(a.falhas, 1);
  assert.match(Object.keys(a.falhasPorCausa)[0], /Navegador travou/);
});

test('sem falhas e sem pendentes = concluida', () => {
  const arq = csvTemp(['4611111111', '4622222222']);
  const log = Object.fromEntries([entrada('4611111111', 'sent'), entrada('4622222222', 'skipped_not_registered')]);
  const a = gestao.analisarCampanha(arq, { sentLog: log, blacklist: new Set() });
  assert.strictEqual(a.status, 'concluida');
});

test('blacklist nao conta como pendente', () => {
  const arq = csvTemp(['4611111111', '4622222222']);
  const log = Object.fromEntries([entrada('4611111111', 'sent')]);
  const a = gestao.analisarCampanha(arq, { sentLog: log, blacklist: new Set(['4622222222']) });
  assert.strictEqual(a.pendentes, 0);
  assert.strictEqual(a.blacklist, 1);
  assert.strictEqual(a.status, 'concluida');
});

test('contato que ja recebeu outra campanha no mes aguarda a virada do mes', () => {
  const arq = csvTemp(['4611111111'], 'conviteGrupo_PB');
  const log = Object.fromEntries([entrada('4611111111', 'sent', { categoria: 'patoBranco_PB' })]);
  const a = gestao.analisarCampanha(arq, { sentLog: log, blacklist: new Set() });
  assert.strictEqual(a.status, 'aguardando_mes');
  assert.strictEqual(a.bloqueadosMes, 1);
});

test('em andamento estima dias pela capacidade dos zaps prontos', () => {
  const arq = csvTemp(Array.from({ length: 100 }, (_, i) => `46${String(10000000 + i)}`));
  const log = Object.fromEntries([entrada('4610000000', 'sent')]);
  const zaps = [{ pronto: true, cap: 48 }, { pronto: true, cap: 48 }, { pronto: false, cap: 48 }];
  const a = gestao.analisarCampanha(arq, { sentLog: log, blacklist: new Set(), zaps });
  assert.strictEqual(a.status, 'em_andamento');
  assert.strictEqual(a.previsaoDias, 2);
});

test('semDDI normaliza telefones da blacklist', () => {
  assert.strictEqual(gestao.semDDI('+55 16 99123-4567'), '16991234567');
  assert.strictEqual(gestao.semDDI('16991234567'), '16991234567');
});

test('identificador do zap: numero primeiro, slot vazio explicito', () => {
  assert.strictEqual(core.identificadorZap({ id: 'a', apelido: 'Chip 2', numero: '5516991400423' }), '+55 16 99140-0423');
  assert.strictEqual(core.identificadorZap({ id: 'a', apelido: 'wes trabalho', numero: '5516997214286' }), '+55 16 99721-4286 (wes trabalho)');
  assert.strictEqual(core.identificadorZap({ id: 'a', apelido: 'Chip 3', numero: null }), 'Chip 3 (vazio)');
});

test('erros minificados do WhatsApp Web ganham explicacao', () => {
  assert.match(core.traduzirMensagem('r').mensagem, /Erro interno do WhatsApp Web/);
  assert.strictEqual(core.traduzirMensagem('r').codigoBruto, 'r');
  assert.strictEqual(core.traduzirMensagem('Timeout real').codigoBruto, null);
});

test('dadosGestao devolve a estrutura usada pela visao TPM do painel', () => {
  const d = gestao.dadosGestao(7);
  assert.strictEqual(d.serie.length, 7);
  assert.strictEqual(d.serie.reduce((s, x) => s + x.n, 0), d.totalPeriodo);
  assert.ok(Array.isArray(d.recs) && d.recs.length > 0);
  assert.ok(d.recs.every(r => r.prioridade && r.achado && r.acao));
  assert.ok(d.utilizacaoPct >= 0);
  for (const k of ['zaps', 'lotes', 'topErros', 'totais', 'capPotencial', 'blacklist']) assert.ok(k in d, k);
});

test('relatorio em texto continua com as 6 secoes e usa as chaves novas do menu', () => {
  const md = gestao.relatorioGestao(7);
  for (let i = 1; i <= 6; i++) assert.match(md, new RegExp(`## ${i}\\. `));
  assert.doesNotMatch(md, /menu \[\d+\]/);
});

test('semaforo conta as tarefas por nivel', () => {
  const s = gestao.semaforo();
  assert.strictEqual(typeof s.urgentes, 'number');
  assert.strictEqual(typeof s.atencao, 'number');
  assert.strictEqual(typeof s.info, 'number');
});
