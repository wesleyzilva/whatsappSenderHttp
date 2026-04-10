# WhatsApp Sender \u2014 Dra. Daiana Ferraz

Ferramenta de disparos de WhatsApp para reativa\u00e7\u00e3o de pacientes da base da cl\u00ednica (odontologia est\u00e9tica e harmoniza\u00e7\u00e3o facial).

**Desenvolvimento:** Wesley Silva

## Objetivo de neg\u00f3cio

Enviar mensagens personalizadas e humanizadas para pacientes j\u00e1 cadastrados, convidando-os a agendar ou conhecer um servi\u00e7o novo \u2014 sem tom de venda, sem press\u00e3o, no tempo certo.  
Al\u00e9m disso, exportar a base de contatos para o Google Ads (Customer Match) para que os an\u00fancios alcancem quem j\u00e1 \u00e9 paciente da Dra. Daiana.

## Como os dois projetos funcionam juntos

```
WhatsappSenderHttp (este repo)
    \u2514\u2500\u25ba 01_fontes/          \u2190 CSVs de pacientes (Simples Dental + contatos manuais)
    \u2514\u2500\u25ba 01_gerar_lista.py   \u2190 filtra, personaliza e gera CSV de disparo por campanha
    \u2514\u2500\u25ba 02_disparos/        \u2190 CSV pronto para envio
    \u2514\u2500\u25ba 02_sender.js        \u2190 abre WhatsApp Web e envia com cad\u00eancia humana
    \u2514\u2500\u25ba 03_log/             \u2190 registra tudo (sem reenvio, dedup por telefone/m\u00eas)
    \u2514\u2500\u25ba 04_publico/         \u2190 exporta emails e fones para Google Ads Customer Match

dradaianaferraz_gold (repo irm\u00e3o)
    \u2514\u2500\u25ba Landing page        \u2190 capta novos leads via Google Ads
    \u2514\u2500\u25ba Customer Match      \u2190 alcana\u00e7 a base do sender nos an\u00fancios
```

## Execu\u00e7\u00e3o

Abra o PowerShell na pasta raiz e execute:

```powershell
.\03_disparar.ps1
```

O menu guia todas as opera\u00e7\u00f5es:

| Op\u00e7\u00e3o | A\u00e7\u00e3o |
|---|---|
| `[1]` | Enviar mensagens (at\u00e9 100/dia, cad\u00eancia humana) |
| `[2]` | Dry-run \u2014 simula sem enviar |
| `[3]` | Envio com limite manual |
| `[4]` | Ver status do log |
| `[5/6]` | Limpar log completo ou por execu\u00e7\u00e3o |
| `[7]` | Gerar nova lista (roda `01_gerar_lista.py`) |
| `[8]` | Exportar Customer Match para Google Ads |

## Regras de envio

- M\u00e1ximo **100 mensagens/dia** por conta WhatsApp
- Envios somente entre **08h e 20h** (segunda a s\u00e1bado)
- Dedup por telefone + m\u00eas \u2014 mesmo n\u00famero n\u00e3o recebe duas vezes no mesmo m\u00eas
- **blacklist.txt**: n\u00fameros que pediram opt-out nunca recebem mensagem nem entram no Customer Match

## Estrutura de pastas

```
01_fontes/    \u2190 arquivos-fonte (CSVs exportados do Simples Dental)
02_disparos/  \u2190 listas geradas pelo 01_gerar_lista.py
03_log/       \u2190 sent_log.json (hist\u00f3rico de envios)
04_publico/   \u2190 customer match export para Google Ads
blacklist.txt \u2190 opt-out
```

## Stack

Node.js \u00b7 Python 3 \u00b7 PowerShell 5 \u00b7 WhatsApp Web (sem API oficial)