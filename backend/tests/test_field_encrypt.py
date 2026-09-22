"""Crux check for DPDP Rule 6 encryption-at-rest: is_identifier=True fields in a
submission's data_json must round-trip through encrypt/decrypt, legacy plaintext
rows (written before this was wired in) must keep reading unchanged, and forms
with no identifier fields must be a true no-op. If this breaks, either identifier
values get corrupted on read, or encryption silently stops applying."""
from app.services.field_encrypt import encrypt_identifiers, decrypt_identifiers
from app.core.field_crypto import encrypt_field, decrypt_field, FieldCryptoError

SCHEMA = {"sections": [{"fields": [
    {"id": "q_name", "type": "text", "is_identifier": True},
    {"id": "q_phone", "type": "text", "is_identifier": True},
    {"id": "q_age", "type": "number"},
]}]}

NO_ID_SCHEMA = {"sections": [{"fields": [{"id": "q_age", "type": "number"}]}]}


def test_round_trip_encrypts_only_identifier_fields():
    data = {"q_name": "Asha Devi", "q_phone": "+919876543210", "q_age": 34}
    enc = encrypt_identifiers(data, SCHEMA)
    assert enc["q_name"] != "Asha Devi"
    assert enc["q_phone"] != "+919876543210"
    assert enc["q_age"] == 34  # non-identifier field untouched

    dec = decrypt_identifiers(enc, SCHEMA)
    assert dec["q_name"] == "Asha Devi"
    assert dec["q_phone"] == "+919876543210"
    assert dec["q_age"] == 34


def test_legacy_plaintext_row_decrypts_unchanged():
    """A row written before encryption was wired in must not error or corrupt
    on read — decrypt_identifiers falls back to the stored value."""
    legacy = {"q_name": "Ramesh Kumar", "q_phone": "9998887776", "q_age": 40}
    dec = decrypt_identifiers(legacy, SCHEMA)
    assert dec == legacy


def test_no_identifier_fields_is_a_true_noop():
    data = {"q_age": 34}
    assert encrypt_identifiers(data, NO_ID_SCHEMA) == data
    assert decrypt_identifiers(data, NO_ID_SCHEMA) == data


def test_non_dict_data_passes_through():
    assert encrypt_identifiers(None, SCHEMA) is None
    assert decrypt_identifiers(None, SCHEMA) is None


def test_empty_or_missing_identifier_value_untouched():
    data = {"q_name": "", "q_age": 5}
    enc = encrypt_identifiers(data, SCHEMA)
    assert enc["q_name"] == ""  # nothing to encrypt
    assert "q_phone" not in enc  # field absent from data_json stays absent


def test_field_crypto_round_trip_and_tamper_rejected():
    plain = "Asha Devi, +919876543210"
    enc = encrypt_field(plain)
    assert enc != plain
    assert decrypt_field(enc) == plain

    assert encrypt_field("") == "" and decrypt_field("") == ""

    try:
        decrypt_field("not-a-real-token")
        assert False, "garbage input should have raised FieldCryptoError"
    except FieldCryptoError:
        pass
