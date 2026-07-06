#!/usr/bin/env bash
#
# Approve all staged @vendure/* packages at a given version.
#
# After a GitHub release triggers publish_to_npm.yml, every published
# package lands in npm's staging area. This script finds them and
# approves them all behind a single 2FA prompt (the 5-min OTP-skip
# window covers the rest).
#
# Usage:
#   ./scripts/npm-stage-approve-all.sh 3.7.0
#   ./scripts/npm-stage-approve-all.sh 3.7.0 --yes        # skip prompt
#   ./scripts/npm-stage-approve-all.sh 3.7.0 --dry-run    # plan only
#
# A package is only approved if it has a staged version EXACTLY matching
# the version arg. Packages with no matching staged version are skipped
# (printed for visibility — usually means a previous nightly is staged,
# or that package didn't change in this release).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_vendure-packages.sh
source "$SCRIPT_DIR/_vendure-packages.sh"

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <version> [--yes] [--dry-run]" >&2
  echo "Example: $0 3.7.0" >&2
  exit 2
fi

TARGET_VERSION="$1"
shift

ASSUME_YES=0
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --yes|-y) ASSUME_YES=1 ;;
    --dry-run) DRY_RUN=1 ;;
    *) echo "Unknown arg: $arg" >&2; exit 2 ;;
  esac
done

# Preflight (shared helpers from _vendure-packages.sh)
vendure_require_npm || exit 1
vendure_require_login || exit 1

# Resolve staged entries matching $TARGET_VERSION for every package.
# Each PENDING entry is recorded as "<pkg> <id>".
pending=()
missing=()
other_versions=()

echo "==> Looking for staged @vendure/* packages at version $TARGET_VERSION"
for pkg in "${VENDURE_PACKAGES[@]}"; do
  if ! list_json=$(npm stage list "$pkg" --json 2>/dev/null); then
    missing+=("$pkg (stage list failed)")
    continue
  fi

  # Extract the matching stage id (if any) and any non-matching versions
  # for visibility. JSON shape: [{id, version, ...}]
  parsed=$(printf '%s' "$list_json" | node -e '
    const data = JSON.parse(require("fs").readFileSync(0, "utf8"));
    const target = process.argv[1];
    if (!Array.isArray(data) || data.length === 0) {
      console.log("EMPTY");
      process.exit(0);
    }
    const match = data.find(e => e.version === target);
    if (match) {
      console.log("MATCH " + match.id);
    }
    const others = data.filter(e => e.version !== target).map(e => e.version);
    if (others.length) {
      console.log("OTHER " + others.join(","));
    }
  ' "$TARGET_VERSION" 2>/dev/null) || parsed="ERROR"

  while IFS= read -r line; do
    case "$line" in
      "MATCH "*)
        pending+=("$pkg ${line#MATCH }")
        ;;
      "EMPTY")
        missing+=("$pkg (nothing staged)")
        ;;
      "OTHER "*)
        other_versions+=("$pkg has staged versions: ${line#OTHER }")
        ;;
      "ERROR")
        # node failed to parse `npm stage list` output — surface it rather
        # than silently dropping the package from all tracking arrays.
        missing+=("$pkg (could not parse stage list output)")
        ;;
    esac
  done <<< "$parsed"
done

echo
if [[ ${#pending[@]} -eq 0 ]]; then
  echo "Nothing staged at $TARGET_VERSION. Nothing to do."
  if [[ ${#other_versions[@]} -gt 0 ]]; then
    echo
    echo "Other staged versions exist (not approved):"
    printf '  - %s\n' "${other_versions[@]}"
  fi
  exit 0
fi

echo "Will approve ${#pending[@]} staged package(s) at version $TARGET_VERSION:"
for entry in "${pending[@]}"; do
  pkg="${entry%% *}"
  id="${entry##* }"
  echo "  - $pkg (stage id: $id)"
done

if [[ ${#missing[@]} -gt 0 ]]; then
  echo
  echo "Skipped (nothing staged at $TARGET_VERSION):"
  printf '  - %s\n' "${missing[@]}"
fi

if [[ ${#other_versions[@]} -gt 0 ]]; then
  echo
  echo "FYI — other staged versions exist (will NOT be approved):"
  printf '  - %s\n' "${other_versions[@]}"
fi

echo

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "(--dry-run) No approvals performed."
  exit 0
fi

if [[ "$ASSUME_YES" -ne 1 ]]; then
  read -r -p "Approve all ${#pending[@]} now? [y/N] " reply
  if [[ ! "$reply" =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
  fi
fi

failed=()
approved=0
for entry in "${pending[@]}"; do
  pkg="${entry%% *}"
  id="${entry##* }"
  echo
  echo "==> Approving $pkg ($id)"
  if ! npm stage approve "$id"; then
    echo "  ! approve failed for $pkg ($id)" >&2
    failed+=("$pkg $id")
    continue
  fi
  approved=$((approved + 1))
  # Stay inside the 5-minute 2FA skip window without hammering the API.
  sleep 2
done

echo
echo "Approved: $approved / ${#pending[@]}"
if [[ ${#failed[@]} -gt 0 ]]; then
  echo "Failures:"
  printf '  - %s\n' "${failed[@]}"
  exit 1
fi
