<h1 align="center">WhatsApp Sender — Dra. Daiana Ferraz</h1>

<p align="center">
  <em>Automated patient reactivation engine with deduplication, opt-out enforcement, and Google Ads Customer Match integration</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=nodedotjs&logoColor=white"/>
  <img src="https://img.shields.io/badge/Python-3.10+-3776AB?style=for-the-badge&logo=python&logoColor=white"/>
  <img src="https://img.shields.io/badge/PowerShell-5.1+-5391FE?style=for-the-badge&logo=powershell&logoColor=white"/>
  <img src="https://img.shields.io/badge/Google%20Ads-Customer%20Match-4285F4?style=for-the-badge&logo=googleads&logoColor=white"/>
</p>

---

> Automated patient reactivation engine combining WhatsApp outreach with Google Ads Customer Match. Enforces monthly per-patient deduplication, opt-out compliance, and daily send limits — converting a dormant contact database into a continuously attributed, measurable revenue stream with full closed-loop campaign integration.

---

## The Problem

Clinics accumulate large patient bases but have no systematic way to re-engage patients who have not returned in months. Manual outreach is inconsistent, frequently reaches the same patient multiple times, and generates zero data for attribution. The result: opt-outs increase, revenue from the existing base stagnates, and the acquisition cost of new patients rises with no counterbalance.

---

## The Solution

A three-stage automation pipeline — list generation, controlled dispatch, and Customer Match export — that converts a static patient CSV into a measurable re-engagement channel. Every message is deduplicated by phone + calendar month, checked against a blacklist, and capped at 100 sends per day to protect account health.

---

## Methodology

```
01_fontes/ (source data)
    ├─ contacts.csv          ← patient base
    ├─ blacklist.txt         ← opt-outs (never contacted)
    └─ informacoescliente.txt ← clinic config and message template

Stage 1 — Generate list (01_gerar_lista.py)
    └─► Deduplicate by phone + current month
    └─► Enforce blacklist
    └─► Output: 02_disparos/lista_disparos_A_YYYYMMDD.csv

Stage 2 — Dispatch (02_sender.js via 03_disparar.ps1)
    └─► Read run_*.json config (which CSV, which account, limits)
    └─► Send messages respecting daily cap (100/account)
    └─► Log results to 03_log/
    └─► Progress bar + real-time status in terminal

Stage 3 — Customer Match export
    └─► Export contacted phones as hashed SHA-256 list
    └─► Upload to Google Ads → re-target existing patient base
```

**Operational rules:**

| Rule | Value |
|------|-------|
| Max sends per day | 100 per account |
| Operating hours | Mon–Sat, 08:00–20:00 |
| Deduplication window | Phone + calendar month |
| Opt-out enforcement | Blacklist checked before every send |

---

## Results

- Dormant patient base converted into an active, attributed re-engagement channel
- Opt-out rate controlled through monthly deduplication and blacklist enforcement
- Customer Match closes the loop: reactivated patients re-enter Google Ads as a targetable audience on the landing page campaign

**How it connects to the landing page:**

| Stream | Tool | Google Ads |
|--------|------|-----------|
| New patients | `dradaianaferraz_gold` landing page | Conversion tracking (acquisition) |
| Existing patients | `whatsappSenderHttp` (this repo) | Customer Match (retention + re-targeting) |

---

## Tradeoffs

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|----------|
| Dispatch method | Web automation | Official WhatsApp Business API | The official API requires WABA approval and per-message fees; web automation has zero marginal cost but requires an active WhatsApp session on a dedicated device |
| Storage | Flat files (CSV/JSON) | Relational database | A database adds infrastructure and operational overhead; flat files are portable, version-controlled, and sufficient for a single-operator workflow with auditable dispatch logs |
| Processing model | Batch (daily cap) | Real-time / event-driven | Real-time dispatch risks triggering WhatsApp rate-limiting and account suspension; a 100/day hard cap protects the account while maintaining a consistent re-engagement cadence |
| Deduplication window | Phone + calendar month | Permanent opt-out only | Monthly deduplication re-enables contact after a natural break, balancing re-engagement frequency with opt-out risk better than a permanent block |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Dispatch engine | Node.js 18+ |
| List generation | Python 3.10+ |
| Orchestration | PowerShell 5.1 |
| Ads integration | Google Ads Customer Match (SHA-256 hashed) |
| Storage | CSV / JSON (flat-file, no database required) |

---

## Getting Started

```bash
npm install          # install Node.js dependencies
```

**Run full pipeline:**
```powershell
.\03_disparar.ps1    # interactive menu: generate list → dispatch → export
```

**Manual stages:**
```bash
python 01_gerar_lista.py      # generate deduplicated dispatch list
node 02_sender.js             # start dispatcher (reads run_*.json config)
```
  <em>Operational patient reactivation tool integrating WhatsApp outreach with Google Ads Customer Match</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=nodedotjs&logoColor=white"/>
  <img src="https://img.shields.io/badge/Python-3.10+-3776AB?style=for-the-badge&logo=python&logoColor=white"/>
  <img src="https://img.shields.io/badge/PowerShell-5.1+-5391FE?style=for-the-badge&logo=powershell&logoColor=white"/>
  <img src="https://img.shields.io/badge/Google%20Ads-Customer%20Match-4285F4?style=for-the-badge&logo=googleads&logoColor=white"/>
</p>

---

## The Problem It Solves

Clinics accumulate a large patient base but have no systematic way to re-engage patients who have not returned in months. Manual outreach is time-consuming, inconsistent, and frequently reaches the same patient multiple times — causing noise and opt-outs.

This tool automates patient reactivation with deduplication by month, opt-out (blacklist) enforcement, daily send limits, and automatic Customer Match export to Google Ads — transforming an idle contact list into an active revenue channel.

---

## How It Connects to the Landing Page

```
Google Ads
    └─► Landing page (dradaianaferraz_gold)
             └─► new patient clicks WhatsApp
                      └─► conversion recorded in Google Ads

WhatsappSenderHttp (this repository)
    └─► reactivates existing patient base via WhatsApp
    └─► exports Customer Match to Google Ads
             └─► Google Ads re-targets the clinic's own patient base
```

- This project works the **existing** patient base.
- The landing page captures **new** contacts.
- Customer Match connects both streams inside Google Ads.

---

## Operational Rules

| Rule | Value |
|------|-------|
| Maximum sends per day | 100 messages per account |
| Operating hours | Monday–Saturday, 08:00–20:00 |
| Deduplication window | Per phone number + calendar month |
| Opt-out enforcement | Blacklist file checked before every send |

---

## Operational Flow

```
1. Update source files in 01_fontes/
2. Verify blacklist is current
3. Generate dispatch list with 01_gerar_lista.py
4. Validate CSV in 02_disparos/
5. Run dry-run before live send
6. Execute send via 03_disparar.ps1
7. Review execution log in 03_log/
8. Export Customer Match to 04_publico/ if needed
```

---

## Menu Options

| Option | Action |
|--------|--------|
| `[1]` | Send messages |
| `[2]` | Dry-run (simulate without sending) |
| `[3]` | Send with manual limit |
| `[4]` | View log status |
| `[5]` | Clear full history |
| `[6]` | Clear a specific execution |
| `[7]` | Generate new dispatch list |
| `[8]` | Export Customer Match |

---

## Prerequisites & Setup

```powershell
# Install Node.js 18+ and Python 3.10+ before proceeding
# Python script uses only standard library — no pip install required

cd C:\repositorio\whatsappSenderHttp
npm install
```

## Running

```powershell
cd C:\repositorio\whatsappSenderHttp
.\03_disparar.ps1
```

---

## Project Structure

```
01_fontes/              source contact files
01_fontes/blacklist.txt central opt-out list
02_disparos/            generated dispatch lists
03_log/                 execution history and logs
04_publico/             Google Ads Customer Match exports
```

---

## Tech Stack

![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat-square&logo=nodedotjs&logoColor=white)
![Python](https://img.shields.io/badge/Python-3776AB?style=flat-square&logo=python&logoColor=white)
![PowerShell](https://img.shields.io/badge/PowerShell-5391FE?style=flat-square&logo=powershell&logoColor=white)

---

## Author

**Wesley Gomes da Silva** · IT Manager · Agile Coach · Full-Stack Developer

[GitHub](https://github.com/wesleyzilva) · [LinkedIn](https://www.linkedin.com/in/wesleyzilva/) · [Portfolio](https://wesleyzilva.github.io/portfolioNearshoreWesIA/#hero)

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