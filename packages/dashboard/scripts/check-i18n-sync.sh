#!/usr/bin/env bash
#
# Checks that i18n catalogs are in sync with source code.
# Distinguishes between meaningful changes (new/removed/changed translations)
# and cosmetic changes (line reference shifts in #: comments).
#
set -euo pipefail

LOCALES_DIR="src/i18n/locales"

npx lingui extract 2>/dev/null

if git diff --exit-code "$LOCALES_DIR" > /dev/null 2>&1; then
    echo "i18n catalogs are in sync"
    exit 0
fi

# Filter the diff to only meaningful lines: ignore #: (source references) and #~ (obsolete markers).
# Also ignore the diff header lines (--- +++ @@).
MEANINGFUL_DIFF=$(git diff "$LOCALES_DIR" | grep '^[+-]' | grep -v '^[+-][+-][+-]' | grep -v '^[+-]#:' | grep -v '^[+-]#~' || true)

if [[ -z "$MEANINGFUL_DIFF" ]]; then
    echo "::warning::i18n source references (#:) are out of date, but translations are in sync. Run 'npm run i18n:extract --workspace=@vendure/dashboard' to update line references."
    exit 0
fi

echo "::error::i18n catalogs are out of sync with source code." >&2
echo "" >&2
echo "The .po files differ after running 'lingui extract':" >&2
git diff --stat "$LOCALES_DIR" >&2
echo "" >&2
echo "Fix: run 'npm run i18n:extract --workspace=@vendure/dashboard' and commit the updated .po files." >&2
exit 1
