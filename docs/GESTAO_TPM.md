# Gestão do projeto (visão TPM)

Documento de acompanhamento baseado nos logs (`03_log/erros/*.jsonl`) e no backlog do usuário (`03_log/errosAmelhorar.txt`). Os números abaixo vêm da análise feita nesta entrega; para valores atualizados rode `node 06_gestao.js --gestao` (menu `[21]`).

## 1. Diagnóstico dos logs

| Achado | Impacto | Correção |
|---|---|---|
| Erro "Socket" do Chip 1 repetia a cada hora (classificado errado até 20/10) | Tempo perdido tentando número desconectado | Circuito de proteção: 2 falhas seguidas de conexão = quarentena de 6h; mensagens de erro traduzidas (`traduzirMensagem`) |
| 13 execuções vazias (cerca de 174 min) | Rodadas sem envio | Contínuo termina ao concluir; alerta "ação necessária" |
| Queda de internet de cerca de 2,8h | Atraso | Retomada automática; relatório destaca |
| 0 envios em 18 e 19/10 | Cadência perdida | Painel e `[A]` avisam o motivo |
| Erros minificados ("r") | Diagnóstico difícil | Tradução e classificação no log |
| Falhas nunca são retentadas (28 na lista Pato Branco) | Perda silenciosa de 2,6% | Menu `[20]` / `--retentar-falhas` |
| Blacklist não era aplicada no envio | Risco de reclamação / LGPD | Aplicada em `montarPlano` |
| Chave de mês em UTC vs. local | Dedup inconsistente na virada do mês | Chave em mês local |
| Reenvio de lista antiga na virada do mês | Mensagem duplicada | Contínuo recusa lista antiga (`PERMITIR_LISTA_ANTIGA` para forçar) |
| Filtro de DDD gerava falso "concluído" | Campanha dada como encerrada | `pendentesForaDoFiltro` + estado `filtro_ddd` |
| README e regras desatualizados | Operação inconsistente | README atualizado |

### Lista Pato Branco (pergunta "foi 100%?")

1084 contatos únicos, todos processados: 1054 enviados (97%), 2 sem WhatsApp, 28 falhas, 0 pendentes. O número "6504 registros" do seletor antigo contava linhas do CSV, não contatos. Em termos operacionais: **concluída com ressalvas** (as 28 falhas podem ser retentadas).

## 2. Backlog do usuário: status

| Pedido (`errosAmelhorar.txt`) | Status |
|---|---|
| Não perder tempo com números desconectados | Feito (circuito + quarentena) |
| Listar só os 3 CSVs mais recentes | Feito (`--csvs=3`, seletor do menu) |
| Menu e abas mostrando o que pode ser verificado | Feito (menu agrupado, `[A]`, `[H]`; painel com 4 abas) |
| Telefone no lugar de "Chip 1/2/3"; vazio se não houver número | Feito (`identificadorZap`) |
| Responder se a campanha foi 100% | Feito (`[19]`, aba Campanhas) |
| Encerrar o modo contínuo ao terminar | Feito (sai com código 0; supervisor para) |
| Convite ao grupo de Harmonização Orofacial (Pato Branco) | Pronto, **falta o link do grupo** (`[22]`; modelo em `01_fontes/mensagem_grupo_harmonizacao.txt`). Só sai a partir do próximo mês pela regra 1 msg/telefone/mês |

## 3. KPIs e cadência

- **Cobertura da campanha**: enviados / contatos únicos (meta >= 97%).
- **Taxa de falha**: falhas / tentativas (alvo < 3%).
- **Utilização da capacidade**: envios 24h / (números ativos x 48).
- **Dias sem envio** e **horas de quarentena** por número.
- Cadência sugerida: diária (secretária, `[A]`, 5 min); semanal (TPM, `[21]` com `--dias=7`); mensal (fechamento, `[19]`, decisão da próxima campanha).

## 4. Registro de riscos

| Risco | Prob. | Impacto | Mitigação / dono |
|---|---|---|---|
| Banimento de número por volume/denúncia | Média | Alto | Limite 48/24h; sem opt-out hoje, ver backlog; TPM |
| Dados pessoais em repositório público (LGPD) | Alta | Alto | Ver seção 6; TPM |
| Falha de máquina/internet interrompe o contínuo | Média | Médio | Supervisor `03a_continuo.ps1`; máquina dedicada (backlog) |
| Mensagem sem opção de sair | Alta | Médio | Incluir linha de opt-out (backlog) |
| Mudança do WhatsApp Web quebra o sender | Média | Alto | Testes; fixar versão do `whatsapp-web.js` |

## 5. Backlog sugerido

1. Receber respostas de opt-out ("SAIR") e alimentar a blacklist automaticamente.
2. Linha de opt-out no texto da campanha Pato Branco.
3. Máquina dedicada com agendador (Task Scheduler) em vez de PC pessoal.
4. Política de retenção dos logs e do `sent_log.json`.
5. CI rodando `node --test tests/*.test.js` em cada PR.
6. Revisar o texto da mensagem com quem responde pelo jurídico/marca.

## 6. Dados pessoais no repositório (ação do TPM)

O repositório rastreia arquivos com telefones e nomes: `01_fontes/contacts.csv`, `informacoescliente.txt`, `gruposwes.csv`, `telefones.txt`, `patoBranco.txt`, `02_disparos/*`, `03_log/sent_log.json`, `04_publico/clientes_google_ads_customer_match.csv`, `05_config/chips_estado.json` e a pasta `grupos/` (cerca de 322 imagens). Se o repositório for público, é exposição de dados. Nada foi removido nesta entrega para não apagar arquivos da cópia de trabalho de quem fizer pull. Passos recomendados:

1. Tornar o repositório privado agora.
2. `git rm --cached` nesses caminhos e acrescentá-los ao `.gitignore`.
3. Reescrever o histórico (`git filter-repo`) para removê-los de commits antigos e forçar um push combinado com a equipe.
4. Trocar quaisquer credenciais/sessões que tenham sido versionadas.

## 7. Decisões necessárias

- Link do grupo de Harmonização Orofacial (Pato Branco).
- Retentar as 28 falhas agora (`[20]`) ou aceitar a perda.
- Tornar o repositório privado e limpar o histórico.
- Incluir linha de opt-out no texto.
- Reler os QRs dos números em quarentena/desconectados.
