
import csv
import re
from pathlib import Path

BASE_DIR  = Path(__file__).parent.parent  # raiz do projeto
FILE1     = BASE_DIR / "01_fontes" / "contacts.csv"
FILE2     = BASE_DIR / "01_fontes" / "Listagem_pacientes-odontologia_estetica_e_facial_-2026-04-08 (3).csv"
BLACKLIST = BASE_DIR / "01_fontes" / "blacklist.txt"

OUT_MAIN      = BASE_DIR / "04_publico" / "clientes_google_ads_customer_match.csv"  # DDD 16
OUT_FORA      = BASE_DIR / "04_publico" / "clientesDeFora.csv"                      # Outros DDDs
OUT_PROBLEMA  = BASE_DIR / "04_publico" / "clientes_problema.csv"                   # Problemas

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")

def load_blacklist() -> set:
    """Carrega números de opt-out do blacklist.txt (sem DDI)."""
    if not BLACKLIST.exists():
        return set()
    nums = set()
    for line in BLACKLIST.read_text(encoding="utf-8").splitlines():
        digits = re.sub(r"\D", "", line)
        if digits:
            nums.add(digits)
    return nums

def normalize_email(email: str) -> str:
    email = email.strip().lower()
    if EMAIL_RE.match(email):
        return email
    return ""

def normalize_phones(phones: str) -> list[str]:
    # Aceita múltiplos separados por / ou ;
    result = []
    for part in re.split(r"[;/]", phones):
        digits = re.sub(r"\D", "", part)
        if 10 <= len(digits) <= 13:
            result.append(digits)
    return result

def main():
    blacklist = load_blacklist()
    records: set[tuple[str, str, str]] = set()

    # Coleta todos os registros
    with FILE1.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            for key in ("E-mail 1 - Value", "E-mail 2 - Value", "E-mail 3 - Value"):
                email = normalize_email((row.get(key) or ""))
                if email:
                    records.add((email, "", "BR"))

            for key in (
                "Phone 1 - Value",
                "Phone 2 - Value",
                "Phone 3 - Value",
                "Phone 4 - Value",
                "Phone 5 - Value",
                "Phone 6 - Value",
            ):
                for phone in normalize_phones((row.get(key) or "")):
                    records.add(("", phone, "BR"))

    with FILE2.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            for phone in normalize_phones((row.get("Celular") or "")):
                digits = re.sub(r"\D", "", phone)
                if digits.startswith("55"):
                    digits = digits[2:]
                if digits not in blacklist:
                    records.add(("", phone, "BR"))

    # Separação das listas
    lista_ddd16 = []
    lista_fora = []
    lista_problema = []

    for email, phone, country in sorted(records, key=lambda x: (x[0], x[1])):
        # Se for email, não separar por DDD
        if email:
            lista_ddd16.append((email, "", country))
            continue

        if not phone:
            lista_problema.append((email, phone, country))
            continue

        # Extrai DDD
        digits = re.sub(r"\D", "", phone)
        if digits.startswith("55") and len(digits) >= 13:
            ddd = digits[2:4]
        elif len(digits) >= 11:
            ddd = digits[:2]
        else:
            ddd = ""

        if ddd == "16":
            lista_ddd16.append((email, phone, country))
        elif ddd:
            lista_fora.append((email, phone, country))
        else:
            lista_problema.append((email, phone, country))

    # Salva arquivos
    with OUT_MAIN.open("w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["Email", "Phone", "Country"])
        writer.writerows(lista_ddd16)

    with OUT_FORA.open("w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["Email", "Phone", "Country"])
        writer.writerows(lista_fora)

    with OUT_PROBLEMA.open("w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["Email", "Phone", "Country"])
        writer.writerows(lista_problema)

    print(f"Arquivo DDD 16: {OUT_MAIN} ({len(lista_ddd16)} registros)")
    print(f"Arquivo clientesDeFora: {OUT_FORA} ({len(lista_fora)} registros)")
    print(f"Arquivo problema: {OUT_PROBLEMA} ({len(lista_problema)} registros)")

if __name__ == "__main__":
    main()
