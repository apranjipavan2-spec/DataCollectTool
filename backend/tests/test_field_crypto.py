"""Envelope encryption for direct-identifier field values (DPDP encryption-
at-rest). If encrypt/decrypt drift apart, either data becomes unrecoverable
(encrypt changes, decrypt doesn't) or a tampered/corrupted value is silently
accepted instead of raising."""
from app.core.field_crypto import encrypt_field, decrypt_field, FieldCryptoError


def test_round_trip():
    plain = "Asha Devi, +919876543210"
    enc = encrypt_field(plain)
    assert enc != plain
    assert decrypt_field(enc) == plain


def test_empty_string_is_safe_passthrough():
    assert encrypt_field("") == ""
    assert decrypt_field("") == ""


def test_tampered_value_raises_not_silently_accepted():
    try:
        decrypt_field("not-a-real-token")
        assert False, "expected FieldCryptoError"
    except FieldCryptoError:
        pass


def test_same_plaintext_encrypts_differently_each_time():
    # Fernet includes a random IV/timestamp — ciphertext must not be
    # deterministic, or repeated identical values would be correlatable
    # at rest even without decrypting them.
    a = encrypt_field("same value")
    b = encrypt_field("same value")
    assert a != b
    assert decrypt_field(a) == decrypt_field(b) == "same value"
