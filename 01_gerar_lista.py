"""
Motor de Mensagens WhatsApp - Dra. Daiana Ferraz
=================================================
Unifica fontes: Listagem_pacientes CSV + contacts.csv + informacoescliente.txt
Chave de deduplicação: (fone_normalizado + nome_normalizado) — preserva
  pessoas diferentes que compartilham o mesmo telefone (família, etc.)

Saída: whatsapp/disparos/
  - lista_disparos_<campanha>_<data>.csv   — todas as colunas + pontuação
  - relatorio_<data>.txt                  — resumo da campanha

Uso: python gerar_disparos.py [--campanha A] [--debug]
"""

import csv
import re
import os
import sys
import argparse
import unicodedata
from datetime import date, datetime
from pathlib import Path

# ──────────────────────────────────────────────────────────────────────────────
# CONFIGURAÇÕES
# ──────────────────────────────────────────────────────────────────────────────

BASE_DIR      = Path(__file__).parent
SAIDA_DIR     = BASE_DIR / "02_disparos"

ARQ_PACIENTES = BASE_DIR / "01_fontes" / "Listagem_pacientes-odontologia_estetica_e_facial_-2026-04-08 (3).csv"
ARQ_CONTACTS  = BASE_DIR / "01_fontes" / "contacts.csv"
ARQ_INFO      = BASE_DIR / "01_fontes" / "informacoescliente.txt"
ARQ_BLACKLIST = BASE_DIR / "01_fontes" / "blacklist.txt"  # números que pediram opt-out

INSTAGRAM  = "https://www.instagram.com/dradaianaferrazsc/"
SITE       = "https://wesleyzilva.github.io/dradaianaferraz_gold/"
GMAPS      = "https://maps.app.goo.gl/SaoCarlosSC"   # ajuste o link real se quiser
LINKEDIN   = "https://www.linkedin.com/in/daiana-ferraz-87b678a8/"
LATTES     = "https://buscatextual.cnpq.br/buscatextual/visualizacv.do?metodo=apresentar&id=K4736476U8"

ASSINATURA = (
    "\n\n"
    "*Dra. Daiana* na Vila Nery\n"
    f"{SITE}"
)

# Termos que indicam profissional da área → excluir
BLACKLIST_TERMOS = [
    "dentista", "protesista", "prótese", "ortodontista", "periodontista",
    "endodontista", "cirurgiao", "radiologista", "odonto", "dra.", "dr.",
    "lab.", "laboratorio", "implantodontista", "protético", "protetista",
    "suporte", "orto", "uniodonto", "convênio", "agenda", "banco de empregos",
    "bafuni", "ambulancia", "banca de", "auto meriele", "bar vitoria",
    "qs luís", "qsluís", "imprima mais", "md projetos", "acisc",
    "acões qs", "auxiliando", "auxilio a lista", "art point",
    "vivian delfino", "contadora", "andreessa oracle",
]

# ──────────────────────────────────────────────────────────────────────────────
# UTILITÁRIOS
# ──────────────────────────────────────────────────────────────────────────────

def carregar_blacklist() -> set:
    """Carrega números de opt-out do blacklist.txt (um por linha, # = comentário)."""
    if not ARQ_BLACKLIST.exists():
        return set()
    numeros = set()
    for linha in ARQ_BLACKLIST.read_text(encoding="utf-8").splitlines():
        linha = linha.strip()
        if not linha or linha.startswith("#"):
            continue
        numeros.add(limpar_fone(linha))
    return numeros


def normalizar(texto: str) -> str:
    """Remove acentos e caixa para comparação."""
    if not texto:
        return ""
    nfkd = unicodedata.normalize("NFKD", texto)
    return "".join(c for c in nfkd if not unicodedata.combining(c)).lower().strip()

def limpar_fone(fone: str) -> str:
    """Mantém apenas dígitos; remove leading 55 quando > 12 dígitos."""
    digitos = re.sub(r"\D", "", fone or "")
    if digitos.startswith("55") and len(digitos) > 12:
        digitos = digitos[2:]
    return digitos

def fone_valido(fone: str) -> bool:
    """Aceita celulares BR: 11 dígitos (DDD+9+XXXXXXXX) ou 10 dígitos legados
    onde o 3º dígito seja 6-9. Rejeita telefones fixos (2-5 após DDD)."""
    f = limpar_fone(fone)
    if len(f) == 11:
        return True
    if len(f) == 10 and len(f) >= 3 and f[2] in '6789':
        return True  # celular formato legado sem o 9 prefixado
    return False

def chave_contato(fone: str, nome: str) -> str:
    """
    Chave composta fone+nome normalizado.
    Permite que duas pessoas com o mesmo telefone (família) fiquem separadas.
    """
    return f"{limpar_fone(fone)}|{normalizar(nome)[:30]}"

def primeiro_nome(nome_completo: str) -> str:
    partes = (nome_completo or "").strip().split()
    return partes[0].capitalize() if partes else "você"

def nome_exibicao(nome_bruto: str, fone: str, seq: int = 0) -> str:
    """
    Retorna nome limpo para exibição.
    Se vazio/genérico, usa 'Paciente' + últimos 4 dígitos do fone.
    """
    nome = (nome_bruto or "").strip()
    # remove sufixos de marcação interna
    nome = re.sub(r"\s*\*+\s*$", "", nome).strip()
    nome = re.sub(r"\s*\(.*?\)\s*$", "", nome).strip()
    if not nome or nome in ("-", "+"):
        ultimos = fone[-4:] if len(fone) >= 4 else fone
        return f"Paciente {ultimos}" + (f"-{seq}" if seq else "")
    return nome

def inferir_genero(nome: str) -> str:
    """Heurística por terminação do primeiro nome."""
    pn = normalizar(primeiro_nome(nome))
    # nomes masculinos conhecidos que terminam em 'a' (excepções)
    masculinos_excecoes = {"adriana", "nikita", "joshua", "luca"}
    if pn in masculinos_excecoes:
        return "M"
    femininos_sufixos = ("a", "ane", "ine", "iane", "ele", "elle", "ely",
                         "ily", "ile", "isse", "ice", "icia", "eis", "eisa")
    masculinos_sufixos = ("o", "on", "or", "er", "an", "in", "el",
                          "ael", "iel", "uel", "al", "il", "os", "is",
                          "us", "eu", "ao", "son", "ton")
    for s in femininos_sufixos:
        if pn.endswith(s):
            return "F"
    for s in masculinos_sufixos:
        if pn.endswith(s):
            return "M"
    return "N"

def dia_semana_pt() -> str:
    dias = ["segunda-feira", "terça-feira", "quarta-feira",
            "quinta-feira", "sexta-feira", "sábado", "domingo"]
    return dias[date.today().weekday()]

def data_hoje_br() -> str:
    return date.today().strftime("%d/%m/%Y")

def parse_data_br(texto: str):
    """Tenta parsear datas em vários formatos; retorna date ou None."""
    meses_abr = {
        "jan": "01", "fev": "02", "mar": "03", "abr": "04",
        "mai": "05", "jun": "06", "jul": "07", "ago": "08",
        "set": "09", "out": "10", "nov": "11", "dez": "12",
    }
    texto = (texto or "").strip()
    m = re.match(r"(\d{1,2}) de (\w+)\.? de (\d{4})", texto, re.IGNORECASE)
    if m:
        dia, mes_txt, ano = m.groups()
        mes = meses_abr.get(normalizar(mes_txt)[:3], "00")
        texto = f"{int(dia):02d}/{mes}/{ano}"
    for fmt in ["%d/%m/%Y", "%d/%m/%y"]:
        try:
            return datetime.strptime(texto, fmt).date()
        except ValueError:
            pass
    return None

def aniversario_proximo(data_nasc):
    """Retorna (fez_recente, faz_este_mes).
    fez_recente : aniversário ocorreu neste mês corrente, antes de hoje.
    faz_este_mes: aniversário será neste mês corrente, a partir de hoje.
    Evita incluir aniversários do mês anterior (ex: marco vs. abril).
    """
    if not data_nasc:
        return False, False
    hoje = date.today()
    try:
        aniv = data_nasc.replace(year=hoje.year)
    except ValueError:
        aniv = data_nasc.replace(year=hoje.year, day=28)
    diff = (aniv - hoje).days
    fez_recente  = (aniv.month == hoje.month and diff < 0)
    faz_este_mes = (aniv.month == hoje.month and diff >= 0)
    return fez_recente, faz_este_mes

def calcular_pontuacao(contato: dict) -> int:
    """
    Pontuação para ordenação da matriz de prioridade (maior = enviar primeiro).
      50 — aniversário (recente ou este mês)
      40 — orçamento em aberto
      30 — agenda ativa (confirmada/agendada)
      20 — paciente com histórico (tem última evolução)
      10 — cadastro só com fone
       +5 — tem CPF/documento
       +3 — tem data de nascimento
       +2 — tem sexo identificado
       +1 — nome completo (> 1 palavra)
    """
    pts = 0
    fez, faz = aniversario_proximo(contato.get("data_nasc"))
    if fez or faz:
        pts += 50
    elif contato.get("orcamento_aberto"):
        orc_date = parse_data_br(contato.get("orcamento_data", ""))
        if orc_date and (date.today() - orc_date).days > 180:
            pts += 35  # orçamento vencido — prioridade ligeiramente menor
        else:
            pts += 40
    elif (contato.get("ultima_consulta_status") or "").lower() in (
            "confirmada", "agendada", "em atendimento"):
        pts += 30
    elif contato.get("ultima_evolucao"):
        pts += 20
    else:
        pts += 10
    if contato.get("doc"):
        pts += 5
    if contato.get("data_nasc"):
        pts += 3
    if contato.get("sexo"):
        pts += 2
    if len((contato.get("nome") or "").split()) > 1:
        pts += 1
    return pts

# ──────────────────────────────────────────────────────────────────────────────
# PARSERS DE FONTE
# ──────────────────────────────────────────────────────────────────────────────

def registro_vazio(nome: str, fone: str, fonte: str, notas: str = "") -> dict:
    return {
        "nome":                   nome,
        "fone":                   fone,
        "idade":                  "",
        "doc":                    "",
        "fonte":                  fonte,
        "sexo":                   "",
        "data_nasc":              None,
        "data_nasc_str":          "",
        "ultima_evolucao":        "",
        "ultima_consulta_data":   "",
        "ultima_consulta_status": "",
        "orcamento_aberto":       False,
        "orcamento_valor":        "",
        "orcamento_data":         "",
        "notas":                  notas,
        "pontuacao":              0,
        "categoria":              "",
        "genero_inferido":        "",
    }


def ler_pacientes_csv() -> dict:
    """
    Lê Listagem_pacientes CSV (separado por ;).
    Chave: chave_contato(fone, nome) — preserva pessoas diferentes no mesmo fone.
    """
    pacientes = {}
    if not ARQ_PACIENTES.exists():
        print(f"[AVISO] Arquivo não encontrado: {ARQ_PACIENTES}")
        return pacientes

    contadores_fone: dict = {}   # fone → count para nomear genéricos

    with open(ARQ_PACIENTES, encoding="utf-8-sig", errors="replace") as f:
        reader = csv.DictReader(f, delimiter=";")
        for row in reader:
            nome_bruto = (row.get("Paciente") or "").strip()
            idade      = (row.get("Idade") or "").strip()
            doc        = re.sub(r"\D", "", row.get("Documento") or "")
            celular    = (row.get("Celular") or "").strip()

            fone = limpar_fone(celular)
            if not fone_valido(fone):
                continue

            # nome genérico se vazio
            seq = contadores_fone.get(fone, 0)
            contadores_fone[fone] = seq + 1
            nome = nome_exibicao(nome_bruto, fone, seq)

            chave = chave_contato(fone, nome)
            existente = pacientes.get(chave)

            # prefere o registro com mais campos preenchidos
            escore_novo = bool(idade) * 2 + bool(doc) * 3 + bool(nome_bruto)
            escore_ant  = (
                bool(existente.get("idade")) * 2 +
                bool(existente.get("doc")) * 3 +
                (len(existente.get("nome", "").split()) > 1)
            ) if existente else -1

            if escore_novo >= escore_ant:
                reg = registro_vazio(nome, fone, "pacientes_csv")
                reg["idade"] = idade
                reg["doc"]   = doc
                pacientes[chave] = reg

    return pacientes


def ler_contacts_csv() -> dict:
    """
    Lê contacts.csv (Google Contatos).
    Chave: chave_contato(fone, nome).
    """
    contatos: dict = {}
    if not ARQ_CONTACTS.exists():
        return contatos

    with open(ARQ_CONTACTS, encoding="utf-8-sig", errors="replace") as f:
        reader = csv.DictReader(f)
        for row in reader:
            partes = [
                row.get("First Name", ""), row.get("Middle Name", ""),
                row.get("Last Name", ""),
            ]
            nome_raw = " ".join(p.strip() for p in partes if p.strip())
            if not nome_raw:
                nome_raw = (row.get("Organization Name") or "").strip()
            notas = (row.get("Notes") or "").strip()
            if not nome_raw and notas:
                m = re.search(r"Paciente:\s*(.+)", notas)
                if m:
                    nome_raw = m.group(1).strip().rstrip("*").strip()

            fones_brutos = [
                row.get("Phone 1 - Value", ""),
                row.get("Phone 2 - Value", ""),
                row.get("Phone 3 - Value", ""),
            ]
            for fb in fones_brutos:
                fone = limpar_fone(fb)
                if not fone_valido(fone):
                    continue
                nome = nome_exibicao(nome_raw, fone)
                chave = chave_contato(fone, nome)
                if chave not in contatos:
                    reg = registro_vazio(nome, fone, "contacts_csv", notas)
                    # tenta extrair idade/doc das notas
                    m_idade = re.search(r"Idade:\s*(\d+)", notas)
                    m_doc   = re.search(r"Documento:\s*(\d+)", notas)
                    if m_idade:
                        reg["idade"] = m_idade.group(1) + " anos"
                    if m_doc:
                        reg["doc"] = m_doc.group(1)
                    contatos[chave] = reg
    return contatos


def enriquecer_com_info_txt(registros: dict) -> None:
    """
    Parseia informacoescliente.txt e enriquece registros com:
    sexo, data_nasc, endereço, última evolução, data/status consultas,
    orçamento aberto (+ valor), notas.
    Busca por fone — atualiza TODOS os registros com aquele fone.
    """
    if not ARQ_INFO.exists():
        return

    with open(ARQ_INFO, encoding="utf-8-sig", errors="replace") as f:
        conteudo = f.read()

    # índice fone → lista de chaves nos registros
    idx_fone: dict = {}
    for chave, reg in registros.items():
        idx_fone.setdefault(reg["fone"], []).append(chave)

    blocos = re.split(r"\n{2,}", conteudo)

    for bloco in blocos:
        bloco = bloco.strip()
        fone_match = re.search(r"\+55\s*([\d\s\-]{8,14})", bloco)
        if not fone_match:
            continue
        fone = limpar_fone("+55" + fone_match.group(1))
        chaves = idx_fone.get(fone, [])
        if not chaves:
            continue

        # extrai campos do bloco
        sexo = ""
        m = re.search(r"Sexo\n(Masculino|Feminino)", bloco)
        if m:
            sexo = "M" if m.group(1) == "Masculino" else "F"

        data_nasc = None
        data_nasc_str = ""
        m = re.search(r"Data de nascimento\n(.+)", bloco)
        if m:
            data_nasc_str = m.group(1).strip()
            data_nasc = parse_data_br(data_nasc_str)

        ultima_evol = ""
        m = re.search(r"Última evolução\n(.+)", bloco)
        if m:
            ultima_evol = m.group(1).strip()

        # consultas: pega a mais recente com data
        consultas = re.findall(
            r"(\d{2}/\d{2}/\d{4}) às \d{2}:\d{2}\n[^\n]+\n(Confirmada|Agendada|"
            r"Finalizada|Falta|Cancelada|Em atendimento)", bloco
        )
        ult_data_consulta = ""
        ult_status_consulta = ""
        if consultas:
            ult_data_consulta, ult_status_consulta = consultas[0]

        orcamento_aberto = bool(re.search(r"Em aberto", bloco, re.IGNORECASE))
        m_valor = re.search(r"R\$\s*([\d\.,]+)", bloco)
        orcamento_valor = m_valor.group(1) if (orcamento_aberto and m_valor) else ""
        orcamento_data_str = ""
        if orcamento_aberto:
            m_orc_dt = re.search(
                r"(\d{2}/\d{2}/\d{4})\n[^\n]+\nR\$\s*[\d\.,]+",
                bloco
            )
            if m_orc_dt:
                orcamento_data_str = m_orc_dt.group(1)

        # aplica a todos os registros com aquele fone
        for chave in chaves:
            reg = registros[chave]
            if not reg["sexo"] and sexo:
                reg["sexo"] = sexo
            if not reg["data_nasc"] and data_nasc:
                reg["data_nasc"] = data_nasc
                reg["data_nasc_str"] = data_nasc_str
            if not reg["ultima_evolucao"] and ultima_evol:
                reg["ultima_evolucao"] = ultima_evol
            if not reg["ultima_consulta_data"] and ult_data_consulta:
                reg["ultima_consulta_data"] = ult_data_consulta
                reg["ultima_consulta_status"] = ult_status_consulta
            if orcamento_aberto:
                reg["orcamento_aberto"] = True
                if not reg["orcamento_valor"]:
                    reg["orcamento_valor"] = orcamento_valor
                if not reg.get("orcamento_data") and orcamento_data_str:
                    reg["orcamento_data"] = orcamento_data_str


# ──────────────────────────────────────────────────────────────────────────────
# FILTROS
# ──────────────────────────────────────────────────────────────────────────────

def eh_profissional(contato: dict) -> bool:
    texto = normalizar(f"{contato['nome']} {contato.get('notas', '')}")
    for termo in BLACKLIST_TERMOS:
        if normalizar(termo) in texto:
            return True
    return False

def filtrar_campanha(contatos: list, campanha: str) -> list:
    """Filtra por letra inicial; 'TODAS' retorna tudo."""
    if campanha == "TODAS":
        return contatos
    letra = normalizar(campanha[0])
    return [c for c in contatos if normalizar(c["nome"]).startswith(letra)]

# ──────────────────────────────────────────────────────────────────────────────
# CLASSIFICAÇÃO / PRIORIDADE
# ──────────────────────────────────────────────────────────────────────────────

def eh_harmonizacao(contato: dict) -> bool:
    """Detecta pacientes de harmonização facial por palavras-chave na evolução/notas."""
    KEYWORDS = [
        "harmoniz", "botox", "toxina", "preenchimento", "bioestimulador",
        "fio de pdo", "sculptra", "skinbooster", "peeling", "laserterapia",
        "bichectomia", "malar", "mento", "preench",
    ]
    texto = normalizar(
        f"{contato.get('ultima_evolucao', '')} {contato.get('notas', '')}"
    )
    return any(kw in texto for kw in KEYWORDS)


def classificar(contato: dict) -> str:
    fez, faz = aniversario_proximo(contato.get("data_nasc"))
    if fez or faz:
        return "aniversario"
    if contato.get("orcamento_aberto"):
        orc_date = parse_data_br(contato.get("orcamento_data", ""))
        if orc_date and (date.today() - orc_date).days > 180:
            return "orcamento_vencido"
        return "orcamento_aberto"
    if eh_harmonizacao(contato):
        return "harmonizacao_manutencao"
    status = (contato.get("ultima_consulta_status") or "").lower()
    if status in ("confirmada", "agendada", "em atendimento"):
        return "agenda_ativa"
    if not contato.get("ultima_evolucao") and not contato.get("ultima_consulta_data"):
        return "sem_historico"
    return "paciente_antigo"

# ──────────────────────────────────────────────────────────────────────────────
# GERAÇÃO DE MENSAGENS
# ──────────────────────────────────────────────────────────────────────────────

DIA_SEMANA = dia_semana_pt()
DATA_HOJE  = data_hoje_br()

# Comentário do dia da semana — aparece ao final de cada mensagem
_COMENTARIOS_DIA = {
    0: "\n\n_(Segunda-feira é o dia certo para começar a semana cuidando de você!)_",
    1: "\n\n_(Terça-feira é aquele empurrãozinho para a semana fluir bem — e cuidar da saúde faz toda a diferença!)_",
    2: "\n\n_(Aproveitando esta quarta-feira para organizar a agenda e já garantir os melhores horários para você!)_",
    3: "\n\n_(Quinta-feira — a semana já está no ritmo certo, que tal aproveitar e agendar um horário?)_",
    4: "\n\n_(Sexta-feira! Que tal fechar a semana com um mimo para você? Adoraríamos te receber!)_",
    5: "\n\n_(Fim de semana chegando — um ótimo momento para pensar em você e agendar aquele cuidado especial!)_",
    6: "",  # domingo — sem comentário
}
COMENTARIO_DIA = _COMENTARIOS_DIA.get(date.today().weekday(), "")

# Dicas rotativas Ana Pegova — uma por mensagem (cicla pelo índice do contato)
DICAS_ANA_PEGOVA = [
    "Dica: experimente nossos produtos da linha Ana Pegova — o *sérum facial* hidrata profundamente e dá aquela luminosidade que todo mundo pergunta o segredo!",
    "Dica: experimente nossos produtos da linha Ana Pegova — o *protetor solar* deixa a pele protegida e com um acabamento lindo, perfeito para o dia a dia!",
    "Dica: experimente nossos produtos da linha Ana Pegova — o *hidratante corporal* tem textura incrível e aquele cheiro que fica na pele o dia inteiro!",
    "Dica: experimente nossos produtos da linha Ana Pegova — o *tônico facial* é um dos queridinhos das pacientes da Dra. Daiana — a pele fica outra!",
    "Dica: experimente nossos produtos da linha Ana Pegova — o *creme para área dos olhos* é perfeito para complementar qualquer tratamento de harmonização!",
    "Dica: experimente nossos produtos da linha Ana Pegova — o *esfoliante facial* remove as células mortas e prepara a pele para absorver melhor os outros produtos!",
    "Dica: experimente nossos produtos da linha Ana Pegova — o *óleo facial noturno* faz o skincare trabalhar enquanto você dorme, e a diferença aparece em dias!",
]
_dica_idx = 0

def proxima_dica() -> str:
    global _dica_idx
    dica = DICAS_ANA_PEGOVA[_dica_idx % len(DICAS_ANA_PEGOVA)]
    _dica_idx += 1
    return dica

def msg_aniversario(nome: str, genero: str, fez: bool) -> str:
    pn = primeiro_nome(nome)
    periodo = "recentemente" if fez else "este mês"
    return (
        f"Oi, {pn}! 🎉\n\n"
        f"Aniversário {periodo} — que data especial!\n\n"
        "A Dra. Daiana e a equipe mandam um abraço enorme e desejam um ano cheio de saúde, "
        "leveza e momentos incríveis pra você! 💛\n\n"
        "Quando quiser comemorar se cuidando, é só chamar — adoraríamos te receber!"
        f"{COMENTARIO_DIA}"
        f"{ASSINATURA}"
    )

def msg_orcamento_aberto(nome: str, genero: str, valor: str = "") -> str:
    pn = primeiro_nome(nome)
    return (
        f"Oi, {pn}! Tudo bem? 😊\n\n"
        "Lembrei de você hoje — ainda tenho aquele orçamento aqui e fico feliz em retomá-lo quando quiser!\n\n"
        "Não precisa de nada formal, só manda um oi que a gente marca um horário tranquilo pra conversar. 💛"
        f"{COMENTARIO_DIA}"
        f"{ASSINATURA}"
    )

def msg_agenda_ativa(nome: str, genero: str) -> str:
    pn = primeiro_nome(nome)
    dica = proxima_dica()
    return (
        f"Oi, {pn}! 😊\n\n"
        "Que ótimo te ter por aqui! Fico feliz que você esteja acompanhando o tratamento.\n\n"
        f"{dica}\n\n"
        "Qualquer dúvida ou novidade, é só chamar — estamos sempre por aqui! 💛"
        f"{COMENTARIO_DIA}"
        f"{ASSINATURA}"
    )

def msg_paciente_antigo(nome: str, genero: str) -> str:
    pn = primeiro_nome(nome)
    return (
        f"Oi, {pn}! 😊\n\n"
        "Já faz um tempinho que não te vejo, e lembrei de você hoje!\n\n"
        "Espero que esteja tudo bem. Quando quiser voltar pra uma consulta ou só tirar uma dúvida, "
        "pode chamar — a porta está sempre aberta pra você! 💛"
        f"{COMENTARIO_DIA}"
        f"{ASSINATURA}"
    )

def msg_orcamento_vencido(nome: str, genero: str, valor: str = "") -> str:
    pn = primeiro_nome(nome)
    return (
        f"Oi, {pn}! Tudo bem? 😊\n\n"
        "Passando pra dar um oi e lembrar que aquele orçamento ainda está aqui, guardado pra você!\n\n"
        "A vida fica corrida mesmo — sem pressão nenhuma. "
        "Quando sentir que é a hora, é só me chamar que a gente retoma tranquilo! 💛"
        f"{COMENTARIO_DIA}"
        f"{ASSINATURA}"
    )

def msg_harmonizacao_manutencao(nome: str, genero: str) -> str:
    pn = primeiro_nome(nome)
    return (
        f"Oi, {pn}! 😊\n\n"
        "Estava pensando em você hoje!\n\n"
        "Os procedimentos de harmonização têm resultados muito melhores quando a manutenção "
        "é feita em dia — e pode estar chegando o momento ideal para o seu retorno.\n\n"
        "*Que tal agendar uma avaliação rápida para conferir como está ficando?* 💛\n\n"
        "É só chamar aqui — encontramos o melhor horário para você!"
        f"{COMENTARIO_DIA}"
        f"{ASSINATURA}"
    )

def msg_sem_historico(nome: str, genero: str) -> str:
    pn = primeiro_nome(nome)
    return (
        f"Oi, {pn}! 😊\n\n"
        "Aqui é a Daiana, de São Carlos!\n\n"
        "Trabalho com harmonização orofacial e odontologia estética, e queria me apresentar. "
        "Qualquer dúvida, curiosidade ou quando quiser marcar uma avaliação — "
        "pode chamar à vontade, sem compromisso! 💛"
        f"{COMENTARIO_DIA}"
        f"{ASSINATURA}"
    )

GERADORES = {
    "aniversario":             msg_aniversario,
    "orcamento_aberto":        msg_orcamento_aberto,
    "orcamento_vencido":       msg_orcamento_vencido,
    "harmonizacao_manutencao": msg_harmonizacao_manutencao,
    "agenda_ativa":            msg_agenda_ativa,
    "sem_historico":           msg_sem_historico,
    "paciente_antigo":         msg_paciente_antigo,
}

def gerar_mensagem(contato: dict) -> str:
    categoria = classificar(contato)
    nome  = contato["nome"]
    sexo  = contato.get("sexo") or inferir_genero(nome)
    if categoria == "aniversario":
        fez, _ = aniversario_proximo(contato.get("data_nasc"))
        return GERADORES[categoria](nome, sexo, fez)
    if categoria in ("orcamento_aberto", "orcamento_vencido"):
        return GERADORES[categoria](nome, sexo, contato.get("orcamento_valor", ""))
    return GERADORES[categoria](nome, sexo)

# ──────────────────────────────────────────────────────────────────────────────
# PIPELINE PRINCIPAL
# ──────────────────────────────────────────────────────────────────────────────

# Colunas do CSV de saída — completas para montar a matriz de prioridade
COLUNAS_SAIDA = [
    "pontuacao",
    "categoria",
    "numero",
    "nome",
    "genero_inferido",
    "idade",
    "data_nasc_str",
    "sexo",
    "doc",
    "ultima_evolucao",
    "ultima_consulta_data",
    "ultima_consulta_status",
    "orcamento_aberto",
    "orcamento_valor",
    "fonte",
    "notas_resumo",
    "mensagem",
]

def main():
    parser = argparse.ArgumentParser(
        description="Motor de disparos WhatsApp — Dra. Daiana Ferraz"
    )
    parser.add_argument("--campanha", default="A",
                        help="Letra inicial da campanha ou 'TODAS' (padrão: A)")
    parser.add_argument("--debug", action="store_true",
                        help="Exibe detalhes no console")
    args = parser.parse_args()

    campanha = args.campanha.upper()
    print(f"\n{'='*60}")
    print(f"  Motor de Mensagens WhatsApp — Campanha: {campanha}")
    print(f"  Data: {DATA_HOJE}  |  {DIA_SEMANA.capitalize()}")
    print(f"{'='*60}\n")

    # 1) Carrega fontes
    print("📂 Carregando fontes de dados...")
    pacientes = ler_pacientes_csv()
    contatos  = ler_contacts_csv()
    print(f"   ✅ Pacientes CSV:  {len(pacientes)} registros (chave composta fone+nome)")
    print(f"   ✅ Contacts CSV:   {len(contatos)} registros")

    # 2) Unifica — pacientes têm prioridade por chave
    unificado = {**contatos, **pacientes}
    print(f"   ✅ Unificado:      {len(unificado)} registros únicos")

    # 3) Enriquece com informacoescliente.txt
    print("📖 Enriquecendo com informacoescliente.txt...")
    enriquecer_com_info_txt(unificado)

    # 4) Remove profissionais
    antes = len(unificado)
    unificado = {k: v for k, v in unificado.items() if not eh_profissional(v)}
    print(f"   🚫 Profissionais removidos: {antes - len(unificado)}")

    # 4b) Remove opt-outs do blacklist.txt
    blacklist = carregar_blacklist()
    if blacklist:
        antes_bl = len(unificado)
        unificado = {k: v for k, v in unificado.items()
                     if limpar_fone(v["fone"]) not in blacklist}
        bl_rm = antes_bl - len(unificado)
        if bl_rm:
            print(f"   🚫 Opt-outs removidos (blacklist.txt): {bl_rm}")

    # 5) Filtro de campanha
    lista = list(unificado.values())
    lista_camp = filtrar_campanha(lista, campanha)
    print(f"   🔤 Campanha '{campanha}': {len(lista_camp)} contatos antes de gerar msgs")

    if not lista_camp:
        print("\n⚠️  Nenhum contato encontrado. Encerrando.")
        sys.exit(0)

    # 6) Calcula pontuação, classifica, gera mensagens
    print("\n✉️  Gerando mensagens e pontuações...")
    stats: dict = {
        "aniversario": 0, "orcamento_aberto": 0, "orcamento_vencido": 0,
        "harmonizacao_manutencao": 0, "agenda_ativa": 0,
        "sem_historico": 0, "paciente_antigo": 0,
    }
    linhas = []

    for c in lista_camp:
        cat   = classificar(c)
        pts   = calcular_pontuacao(c)
        sexo  = c.get("sexo") or inferir_genero(c["nome"])
        msg   = gerar_mensagem(c)
        stats[cat] += 1
        c["categoria"]       = cat
        c["pontuacao"]       = pts
        c["genero_inferido"] = sexo

        linhas.append({
            "pontuacao":              pts,
            "categoria":              cat,
            "numero":                 c["fone"],
            "nome":                   c["nome"],
            "genero_inferido":        sexo,
            "idade":                  c.get("idade", ""),
            "data_nasc_str":          c.get("data_nasc_str", ""),
            "sexo":                   c.get("sexo", ""),
            "doc":                    c.get("doc", ""),
            "ultima_evolucao":        c.get("ultima_evolucao", ""),
            "ultima_consulta_data":   c.get("ultima_consulta_data", ""),
            "ultima_consulta_status": c.get("ultima_consulta_status", ""),
            "orcamento_aberto":       "SIM" if c.get("orcamento_aberto") else "",
            "orcamento_valor":        c.get("orcamento_valor", ""),
            "fonte":                  c.get("fonte", ""),
            "notas_resumo":           (c.get("notas") or "")[:120].replace("\n", " "),
            "mensagem":               msg,
        })

        if args.debug:
            print(f"   [{pts:3d}][{cat:20s}] {c['nome'][:45]:45s} {c['fone']}")

    # 7) Ordena por pontuação decrescente
    linhas.sort(key=lambda x: x["pontuacao"], reverse=True)

    # 8) Deduplica por número de telefone: mesmo fone, categorias diferentes → maior pontuação vence
    seen_fone: dict = {}
    for l in linhas:
        f = l["numero"]
        if f not in seen_fone or l["pontuacao"] > seen_fone[f]["pontuacao"]:
            seen_fone[f] = l
    dedup_count = len(linhas) - len(seen_fone)
    if dedup_count:
        print(f"   ⚠️  {dedup_count} número(s) removido(s) por telefone duplicado (mesmo fone, categorias diferentes)")
    linhas = list(seen_fone.values())
    linhas.sort(key=lambda x: x["pontuacao"], reverse=True)

    # 9) Salva CSV completo
    SAIDA_DIR.mkdir(parents=True, exist_ok=True)
    sufixo = date.today().strftime("%Y%m%d")
    nome_arq = SAIDA_DIR / f"lista_disparos_{campanha}_{sufixo}.csv"
    with open(nome_arq, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=COLUNAS_SAIDA, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(linhas)
    print(f"\n✅ CSV completo: {nome_arq}  ({len(linhas)} linhas)")

    # 10) Relatório
    rel_arq = SAIDA_DIR / f"relatorio_{sufixo}.txt"
    with open(rel_arq, "w", encoding="utf-8") as f:
        f.write(f"Relatório de Campanha — Dra. Daiana Ferraz\n{'='*50}\n")
        f.write(f"Data:           {DATA_HOJE}\n")
        f.write(f"Dia:            {DIA_SEMANA.capitalize()}\n")
        f.write(f"Campanha:       {campanha}\n")
        f.write(f"Total disparos: {len(linhas)}\n\n")
        f.write("Distribuição por categoria:\n")
        for cat, qtd in stats.items():
            f.write(f"  {cat:25s}: {qtd}\n")
        pts_vals = [l["pontuacao"] for l in linhas]
        f.write(f"\nPontuação — mín:{min(pts_vals)}  máx:{max(pts_vals)}  "
                f"média:{sum(pts_vals)/len(pts_vals):.1f}\n")
        f.write(f"\nFontes:\n  - {ARQ_PACIENTES.name}\n"
                f"  - {ARQ_CONTACTS.name}\n  - {ARQ_INFO.name}\n")
    print(f"✅ Relatório:    {rel_arq}")

    # 11) Preview top-3
    print(f"\n{'─'*60}\nPREVIEW — top 3 por pontuação:\n{'─'*60}")
    for linha in linhas[:3]:
        print(f"\n📱 [{linha['pontuacao']:3d} pts] {linha['nome']}  "
              f"({linha['numero']})  [{linha['categoria']}]")
        print(f"   Idade:{linha['idade'] or '-'}  "
              f"Nasc:{linha['data_nasc_str'] or '-'}  "
              f"Sexo:{linha['sexo'] or linha['genero_inferido']+'(inf)'}  "
              f"Doc:{linha['doc'] or '-'}  "
              f"Ult.consulta:{linha['ultima_consulta_data'] or '-'} "
              f"{linha['ultima_consulta_status'] or ''}")
        print("─" * 40)
        print(linha["mensagem"][:300] + "…")

    print(f"\n🏁 Campanha '{campanha}' — {len(linhas)} disparos prontos, "
          f"ordenados por prioridade!\n")


if __name__ == "__main__":
    main()
