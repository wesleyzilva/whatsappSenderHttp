# WhatsApp Sender — Dra. Daiana Ferraz

Ferramenta operacional de WhatsApp para reativação de pacientes da clínica da Dra. Daiana Ferraz e geração de públicos para Google Ads.

**Desenvolvimento:** Wesley Silva

## Finalidade deste projeto

Este repositório existe para operar a base da clínica com segurança e repetibilidade.

Objetivos principais:

1. Gerar listas de disparo a partir dos arquivos de entrada.
2. Evitar reenvio indevido para quem já recebeu no mês.
3. Respeitar opt-out via blacklist.
4. Enviar mensagens com cadência controlada.
5. Exportar Customer Match para Google Ads.

## Como este projeto se conecta ao outro repositório

```
WhatsappSenderHttp (este repositório)
    └─► gera lista de disparo
    └─► envia mensagens por WhatsApp
    └─► exporta Customer Match

dradaianaferraz_gold (repositório irmão)
    └─► capta novos leads no site
    └─► mede conversões de clique no WhatsApp
```

Resumo operacional:

- Este projeto trabalha a base já existente da clínica.
- O projeto da landing page trabalha novos contatos.
- Os dois se conectam no Google Ads.

## Fluxo de uso

Ordem normal de operação:

1. Atualizar os arquivos em `01_fontes/`.
2. Conferir se a `01_fontes/blacklist.txt` está atualizada.
3. Gerar uma nova lista com `01_gerar_lista.py`.
4. Validar o CSV gerado em `02_disparos/`.
5. Fazer `dry-run` antes do envio real.
6. Executar o envio.
7. Conferir o log em `03_log/`.
8. Se necessário, exportar Customer Match em `04_publico/`.

## Pré-requisitos

Instale antes de usar:

| Ferramenta | Versão mínima | Download |
|---|---|---|
| Node.js | 18+ | https://nodejs.org |
| Python | 3.10+ | https://www.python.org |
| PowerShell | 5.1+ | já incluso no Windows 10/11 |

Instale as dependências do projeto (só na primeira vez):

```powershell
cd C:\repositorio\whatsappSenderHttp
npm install
```

> O script Python usa apenas bibliotecas padrão — nenhum `pip install` necessário.

## Como executar

Abra o PowerShell na pasta do projeto:

```powershell
cd C:\repositorio\whatsappSenderHttp
.\03_disparar.ps1
```

O menu principal oferece:

| Opção | Uso |
|---|---|
| `[1]` | enviar mensagens |
| `[2]` | simular envio sem enviar |
| `[3]` | enviar com limite manual |
| `[4]` | ver status do log |
| `[5]` | limpar histórico completo |
| `[6]` | limpar uma execução específica |
| `[7]` | gerar nova lista de disparo |
| `[8]` | exportar Customer Match |

## Regras operacionais

- Máximo de **100 mensagens por dia** por conta.
- Envio apenas entre **08h e 20h**, de segunda a sábado.
- Deduplicação por **telefone + mês**.
- Quem já recebeu no mês atual não entra de novo na lista.
- Quem está em `01_fontes/blacklist.txt` não recebe mensagem e não entra no Customer Match.

## O que validar antes de enviar

- Os arquivos de entrada corretos estão em `01_fontes/`.
- A blacklist está atualizada.
- A campanha escolhida é a correta.
- O arquivo novo foi realmente criado em `02_disparos/`.
- O CSV gerado não contém números inválidos ou óbvios duplicados.

## O que validar depois de gerar a lista

- O CSV contém apenas contatos elegíveis.
- Contatos já enviados no mês atual ficaram fora da lista.
- Números da blacklist ficaram fora da lista.
- A quantidade final faz sentido para a campanha escolhida.

## O que validar depois do envio

- O log em `03_log/` registrou a execução.
- O status (`[4]`) mostra os números enviados.
- Um novo processamento no mesmo mês não reintroduz quem já recebeu.
- O limite diário e a janela de horário foram respeitados.

## O que validar no Customer Match

- O arquivo `04_publico/clientes_google_ads_customer_match.csv` foi gerado.
- Telefones da blacklist não aparecem no export.
- O arquivo está pronto para importação no Google Ads.

## Estrutura de pastas

```text
01_fontes/              arquivos de entrada
01_fontes/blacklist.txt lista central de opt-out
02_disparos/            listas geradas para envio
03_log/                 histórico e logs de execução
04_publico/             exportações para Google Ads
```

## Troubleshooting rápido

Se a lista vier menor do que o esperado:

- revisar deduplicação do mês atual em `03_log/`
- revisar blacklist
- revisar arquivos de entrada

Se um número que deveria sair continuar aparecendo:

- verificar se está formatado corretamente na blacklist
- verificar se o número entrou por outra fonte com formatação diferente

Se um número não deveria receber novamente:

- conferir se o envio anterior foi registrado no log

## Stack

Node.js · Python 3 · PowerShell 5 · WhatsApp Web (sem API oficial)