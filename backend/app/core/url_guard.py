"""SSRF guard for any server-side request to a URL a tenant typed in
(migration servers, webhook targets). Requires https and a publicly-routable
host. DNS is resolved at check time; rebinding between check and request is
out of scope."""
from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlparse


class UnsafeURL(ValueError):
    """URL is not https or resolves to a private/internal address."""


def check_public_https_url(url: str) -> str:
    """Return the URL stripped of whitespace/trailing slash, or raise UnsafeURL."""
    base = url.strip().rstrip("/")
    u = urlparse(base)
    if u.scheme != "https" or not u.hostname:
        raise UnsafeURL("URL must start with https://")
    try:
        infos = socket.getaddrinfo(u.hostname, u.port or 443, proto=socket.IPPROTO_TCP)
    except socket.gaierror:
        raise UnsafeURL(f"Could not resolve host '{u.hostname}'")
    for info in infos:
        if not ipaddress.ip_address(info[4][0]).is_global:
            raise UnsafeURL("URL points to a private or internal address")
    return base
