"""Canonical phone normalization — must mirror the frontend LoginPage.normalizePhone
so a number stored at user-creation matches the one sent at login."""


def normalize_phone(raw: str) -> str:
    """10 digits -> +91XXXXXXXXXX; 12 digits starting 91 -> +91XXXXXXXXXX; else trimmed as-is.
    Non-phone identifiers (emails, placeholder reg_ ids) are returned untouched."""
    if not raw:
        return raw
    raw = raw.strip()
    if "@" in raw or raw.startswith("reg_"):
        return raw
    digits = "".join(c for c in raw if c.isdigit())
    if len(digits) == 10:
        return f"+91{digits}"
    if len(digits) == 12 and digits.startswith("91"):
        return f"+{digits}"
    return raw
