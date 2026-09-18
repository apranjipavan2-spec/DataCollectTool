"""
Brand rename: FieldPulse → FieldGovern
Runs in-place on all text files in the repo.
Safe to re-run (idempotent after first run).
"""
import os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

SKIP_DIRS = {'.git', 'node_modules', '__pycache__', 'backups', 'dist', '.vite'}
SKIP_FILES = {'rename_brand.py', 'context-cold.md'}
TEXT_EXTS = {
    '.ts', '.tsx', '.js', '.jsx', '.json', '.html', '.css', '.md',
    '.py', '.txt', '.toml', '.yml', '.yaml', '.env', '.example',
    '.sh', '.svg',
}

REPLACEMENTS = [
    # Exact case variants — order matters (longer first)
    ('FieldPulse Platform', 'FieldGovern Platform'),
    ('FieldPulse',          'FieldGovern'),
    ('fieldpulse',          'fieldgovern'),
    ('field-pulse',         'field-govern'),
    ('field_pulse',         'field_govern'),
    ('FIELDPULSE',          'FIELDGOVERN'),
    # Domain
    ('fieldpulse.in',       'fieldgovern.com'),
]

changed = []

for dirpath, dirnames, filenames in os.walk(ROOT):
    dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
    for fname in filenames:
        if fname in SKIP_FILES:
            continue
        ext = os.path.splitext(fname)[1].lower()
        if ext not in TEXT_EXTS and fname not in {'.env', '.env.example'}:
            continue
        fpath = os.path.join(dirpath, fname)
        try:
            with open(fpath, 'r', encoding='utf-8', errors='ignore') as f:
                original = f.read()
        except Exception:
            continue
        updated = original
        for old, new in REPLACEMENTS:
            updated = updated.replace(old, new)
        if updated != original:
            with open(fpath, 'w', encoding='utf-8') as f:
                f.write(updated)
            rel = os.path.relpath(fpath, ROOT)
            changed.append(rel)
            print(f'  updated: {rel}')

print(f'\n✓ Brand rename complete — {len(changed)} files updated.')
