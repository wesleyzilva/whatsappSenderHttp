import csv
import re
from pathlib import Path

BASE_DIR  = Path(__file__).parent.parent  # raiz do projeto
FILE1     = BASE_DIR / "01_fontes" / "contacts.csv"
FILE2     = BASE_DIR / "01_fontes" / "Listagem_pacientes-odontologia_estetica_e_facial_-2026-04-08 (3).csv"
BLACKLIST = BASE_DIR / "01_fontes" / "blacklist.txt"
OUT       = BASE_DIR / "04_publico" / "clientes_google_ads_customer_match.csv"

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def load_blacklist() -> set:
    """Carrega números de opt-out do blacklist.txt (sem DDI)."""
    if not BLACKLIST.exists():
        return set()
    nums = set()
    for line in BLACKLIST.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        d = re.sub(r"\D", "", line)
        if d.startswith("55") and len(d) > 12:
            d = d[2:]
        nums.add(d)
    return nums


def normalize_email(value: str) -> str | None:
    if not value:
        return None
    email = value.strip().lower()
    return email if EMAIL_RE.match(email) else None


def normalize_phones(raw: str) -> list[str]:
    if not raw:
        return []

    parts = re.split(r":::|;|\||\n", raw)
    phones: list[str] = []

    for part in parts:
        digits = re.sub(r"\D", "", part or "")
        if not digits:
            continue

        digits = digits.lstrip("0")

        if len(digits) in (10, 11):
            digits = f"55{digits}"
        elif len(digits) > 11 and not digits.startswith("55"):
            continue

        if digits.startswith("55") and len(digits) in (12, 13):
            phones.append(f"+{digits}")

    return phones


def main() -> None:
    blacklist = load_blacklist()
    records: set[tuple[str, str, str]] = set()

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

    # Filtra emails cujo telefone correspondente está bloqueado não é possível via email — mantemos todos emails
    sorted_records = sorted(records, key=lambda x: (x[0], x[1]))

    with OUT.open("w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["Email", "Phone", "Country"])
        writer.writerows(sorted_records)

    total_emails = sum(1 for r in sorted_records if r[0])
    total_phones = sum(1 for r in sorted_records if r[1])

    print(f"Arquivo gerado: {OUT}")
    print(f"Registros únicos: {len(sorted_records)}")
    print(f"- Emails: {total_emails}")
    print(f"- Telefones: {total_phones}")


if __name__ == "__main__":
    main()
