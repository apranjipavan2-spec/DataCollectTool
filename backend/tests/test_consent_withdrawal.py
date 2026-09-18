"""DPDP consent withdrawal by reference code. The ref code a respondent is
shown is computed CLIENT-SIDE (frontend/src/lib/consentRefCode.ts,
refCodeFromId) from the submission's local_id — last 8 hex chars, formatted
XXXX-XXXX. The backend must normalize whatever an admin types back into the
same hex tail regardless of formatting, or a correctly-quoted code would
fail to resolve."""
from app.api.routes.submissions import _normalize_ref_code


def test_normalizes_dashed_uppercase_code():
    assert _normalize_ref_code("A1B2-C3D4") == "a1b2c3d4"


def test_normalizes_code_typed_without_dash():
    assert _normalize_ref_code("a1b2c3d4") == "a1b2c3d4"


def test_normalizes_code_with_stray_whitespace():
    assert _normalize_ref_code(" A1B2 - C3D4 ") == "a1b2c3d4"


def test_strips_non_hex_characters():
    # "R" and ":" aren't hex digits and are stripped; "E"/"F" ARE valid hex
    # digits (0-9, a-f) so they survive — this pins that easy-to-misjudge edge.
    assert _normalize_ref_code("R: A1B2-C3D4!") == "a1b2c3d4"


def test_matches_js_refcodefromid_tail_extraction():
    # Mirrors refCodeFromId(id) in consentRefCode.ts: strip non-hex, take
    # last 8 chars, format XXXX-XXXX. A real client-generated UUID (dashes
    # only ever fall before the last 12-hex-digit group, so its last 8
    # characters are always pure hex — this pins that assumption).
    local_id = "550e8400-e29b-41d4-a716-446655440000"
    js_ref_code = local_id.replace("-", "")[-8:].upper()
    formatted = f"{js_ref_code[:4]}-{js_ref_code[4:]}"
    assert _normalize_ref_code(formatted) == local_id[-8:]
