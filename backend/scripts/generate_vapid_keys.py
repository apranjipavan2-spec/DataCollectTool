"""
Generate VAPID key pair for Web Push notifications.

Usage:
    python -m scripts.generate_vapid_keys

Copy the output into your .env file.
"""
from py_vapid import Vapid

vapid = Vapid()
vapid.generate_keys()

raw_private = vapid.private_pem()
raw_public = vapid.public_key

# Application Server Key (URL-safe base64, no padding) — used by browser pushManager.subscribe()
from pywebpush import webpush
import base64

# Extract raw public key bytes and encode as URL-safe base64
pub_key_bytes = vapid.public_key.public_bytes(
    encoding=__import__("cryptography").hazmat.primitives.serialization.Encoding.X962,
    format=__import__("cryptography").hazmat.primitives.serialization.PublicFormat.UncompressedPoint,
)
application_server_key = base64.urlsafe_b64encode(pub_key_bytes).rstrip(b"=").decode()

# Private key as URL-safe base64 (raw 32-byte scalar)
priv_key_bytes = vapid.private_key.private_numbers().private_value.to_bytes(32, "big")
private_key_b64 = base64.urlsafe_b64encode(priv_key_bytes).rstrip(b"=").decode()

print("\n# ── Web Push VAPID Keys ─────────────────────────────")
print(f'VAPID_PUBLIC_KEY="{application_server_key}"')
print(f'VAPID_PRIVATE_KEY="{private_key_b64}"')
print('VAPID_CLAIM_EMAIL="mailto:admin@fieldpulse.app"')
print("# ────────────────────────────────────────────────────\n")
