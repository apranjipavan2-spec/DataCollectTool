#!/usr/bin/env bash
# sync-docs.sh — copy website/ → docs/ (keeps GitHub Pages in sync with source)
# Run this before every git push: bash sync-docs.sh
set -e
rsync -av --delete --exclude='.git' --exclude='old/' website/ docs/
echo "✓ docs/ synced from website/"
