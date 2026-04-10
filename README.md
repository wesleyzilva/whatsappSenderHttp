# WhatsApp Sender — Dra. Daiana Ferraz

Ferramenta de disparos de WhatsApp para reativação de pacientes da base da clínica da Dra. Daiana Ferraz, com foco em odontologia estética e harmonização facial.

**Desenvolvimento:** Wesley Silva

## Objetivo de negócio

Enviar mensagens personalizadas e humanizadas para pacientes já cadastrados, convidando-os a agendar ou conhecer um serviço novo — sem tom de venda, sem pressão, no tempo certo.
Além disso, exportar a base de contatos para o Google Ads (Customer Match) para que os anúncios alcancem quem já é paciente da Dra. Daiana.

## Como os dois projetos funcionam juntos

```
WhatsappSenderHttp (este repositório)
    └─► 01_fontes/          ← CSVs de pacientes (Simples Dental + contatos manuais)
    └─► 01_gerar_lista.py   ← filtra, personaliza e gera CSV de disparo por campanha
    └─► 02_disparos/        ← CSV pronto para envio
    └─► 02_sender.js        ← abre WhatsApp Web e envia com cadência humana
    └─► 03_log/             ← registra tudo (sem reenvio, dedup por telefone/mês)
    └─► 04_publico/         ← exporta emails e fones para Google Ads Customer Match

dradaianaferraz_gold (repositório irmão)
    └─► Landing page        ← capta novos leads via Google Ads
    └─► Customer Match      ← alcança a base do sender nos anúncios
```

## Execução

Abra o PowerShell na pasta raiz e execute:

```powershell
.\03_disparar.ps1
```

O menu guia todas as operações:

| Opção | Ação |
|---|---|
| `[1]` | Enviar mensagens (até 100/dia, cadência humana) |
| `[2]` | Dry-run — simula sem enviar |
| `[3]` | Envio com limite manual |
| `[4]` | Ver status do log |
| `[5/6]` | Limpar log completo ou por execução |
| `[7]` | Gerar nova lista (roda `01_gerar_lista.py`) |
| `[8]` | Exportar Customer Match para Google Ads |

## Regras de envio

- Máximo **100 mensagens/dia** por conta WhatsApp
- Envios somente entre **08h e 20h** (segunda a sábado)
- Dedup por telefone + mês — mesmo número não recebe duas vezes no mesmo mês
- **`01_fontes/blacklist.txt`**: números que pediram opt-out nunca recebem mensagem nem entram no Customer Match

## Estrutura de pastas

```
01_fontes/              ← arquivos-fonte de entrada (CSVs, telefones, mensagem e blacklist)
02_disparos/            ← listas geradas pelo `01_gerar_lista.py`
03_log/                 ← histórico e logs de execução
04_publico/             ← exportações para Google Ads Customer Match
01_fontes/blacklist.txt ← opt-out central do projeto
```

## Stack

Node.js · Python 3 · PowerShell 5 · WhatsApp Web (sem API oficial)