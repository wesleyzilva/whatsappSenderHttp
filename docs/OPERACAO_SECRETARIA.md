# Guia de operação — secretária

Este guia diz o que fazer no dia a dia. Você não precisa entender o código. Se algo não estiver aqui, pare e fale com o responsável (TPM).

## 1. Rotina diária (5 a 10 minutos)

1. Abra o PowerShell na pasta do projeto e rode `.\03_disparar.ps1`.
2. Digite **`A`** (o que fazer agora). A tela principal já mostra um semáforo ("Agora") com o número de tarefas urgentes. O sistema mostra um semáforo e a próxima ação.
3. Faça o que ele pedir, nesta ordem:
   - **Verde**: nada a fazer. O envio contínuo está rodando ou a campanha acabou.
   - **Amarelo**: algum número precisa de atenção (QR vencido, sem número configurado, aguardando janela de 24h).
   - **Vermelho**: não envie. Chame o responsável.
4. Para operar por botões, digite **`P`** (ou `node 04_painel.js`) e abra <http://localhost:3737>. Use a visão **Operacional** (Hoje, Campanhas, Guia da secretária). A visão **TPM** é do gestor; você não precisa dela.

## 2. Iniciar uma campanha

1. No menu, escolha o envio contínuo (`O1`) ou, se for manual, a área `E`. O sistema lista apenas os **3 CSVs mais recentes**. Escolha o mais novo.
2. Confira o resumo: quantos contatos, quantos já enviados no mês, quantos sobram.
3. Confirme. Os números aparecem pelo **telefone** (não por "Chip 1/2/3"). "Chip N (vazio)" significa que não há número configurado naquele slot, e ele é ignorado.
4. O modo contínuo **termina sozinho** quando a campanha acaba. Não precisa parar manualmente.

## 3. Ler o QR Code

1. Quando o sistema pedir QR, abra o WhatsApp no celular do número indicado.
2. Vá em Aparelhos conectados e escolha Conectar um aparelho.
3. Leia o QR da tela. Ele vence em cerca de 1 minuto; se vencer, o sistema gera outro.
4. Se o mesmo número pedir QR de novo toda hora, **não insista**. Ele entra em quarentena de 6 horas depois de 2 falhas seguidas. Avise o responsável.

## 4. Responder "a campanha terminou 100%?"

- Menu `[C2]` (fechamento da campanha). Ele diz um destes estados:
  - **Concluída**: todos os contatos foram tratados. Pode iniciar a próxima.
  - **Concluída com ressalvas**: terminou, mas há falhas ou números sem WhatsApp. Veja a lista e decida com o responsável (menu `[C3]` reenvia só as falhas).
  - **Em andamento**: ainda há pendentes.
  - **Aguardando mês**: o restante só pode ser enviado a partir do próximo mês (regra de 1 mensagem por telefone por mês).
- Importante: o total de linhas do CSV pode ser maior que o de contatos, porque há números repetidos. O fechamento conta contatos únicos.

## 5. Convite para o grupo de promoções

- Menu `[C4]`. Peça o link do grupo ao responsável (formato `https://chat.whatsapp.com/...`). O sistema recusa links fora desse formato.
- Só funciona para quem ainda não recebeu mensagem **no mês corrente**.

## 6. O que fazer quando...

| Sintoma | O que fazer |
|---|---|
| Número pede QR | Leia o QR (seção 3; menu `Z1`). |
| "Quarentena" ou "circuito aberto" | Espere 6 horas ou avise o responsável. Não reinicie várias vezes. |
| "Sem internet" / muitas falhas de conexão | Verifique a rede. O contínuo retoma sozinho. |
| "Lista antiga" recusada | O CSV é de um mês anterior. Gere uma lista nova (menu de gerar lista). |
| 0 envios no dia | Rode `[A]`. Normalmente é limite de 24h ou número desconectado. |
| Painel não abre | Veja se já há outro painel na porta 3737 (`PORTA=3838 node 04_painel.js`). |

## 7. Não faça

- Não aumente o limite diário (48 por número em 24h) por conta própria.
- Não edite `05_config/*.json`, `sent_log.json` nem os arquivos de `03_log` à mão.
- Não rode duas campanhas ao mesmo tempo.
- Não publique CSVs ou logs fora da máquina. Contêm dados pessoais (LGPD).
- Não envie para quem pediu para sair (lista de bloqueio). O sistema já impede, mas não tente contornar.

## 8. Quando chamar o responsável

Qualquer semáforo vermelho, qualquer número banido ou desconectado repetidamente, qualquer dúvida sobre o texto da mensagem, e o link do grupo.
