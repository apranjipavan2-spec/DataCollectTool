"""DPDP erasure completeness: anonymize must reconstruct the EXACT storage key
upload_media() used, or a photo/audio file silently survives an erasure
request while its DB record and data_json answer are wiped. If this drifts
from upload_media()'s own key formula, storage.delete() targets a
non-existent path and the real file is never removed."""
from types import SimpleNamespace
from app.api.routes.submissions import _media_storage_key
from app.api.routes.sync import _guess_extension


def test_key_matches_upload_media_formula_exactly():
    tenant_id = "11111111-1111-1111-1111-111111111111"
    submission_id = "22222222-2222-2222-2222-222222222222"
    field_name = "photo_field"
    mime = "image/jpeg"

    # This is upload_media()'s own construction (sync.py) — the ground truth.
    expected = f"{tenant_id}/{submission_id}/{field_name}{_guess_extension(mime)}"

    m = SimpleNamespace(tenant_id=tenant_id, submission_id=submission_id,
                         field_name=field_name, mime_type=mime)
    assert _media_storage_key(m) == expected == f"{tenant_id}/{submission_id}/photo_field.jpg"


def test_key_reconstruction_never_crashes_on_missing_mime():
    m = SimpleNamespace(tenant_id="t1", submission_id="s1", field_name="f1", mime_type=None)
    assert _media_storage_key(m) == "t1/s1/f1.bin"


def test_key_reconstruction_handles_audio():
    m = SimpleNamespace(tenant_id="t1", submission_id="s1", field_name="audio_audit", mime_type="audio/webm;codecs=opus")
    assert _media_storage_key(m) == "t1/s1/audio_audit.webm"
