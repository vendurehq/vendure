#!/usr/bin/env bash
#
# Bulk-configure npm Trusted Publishing + MFA for all @vendure/* packages.
#
# What this does, for every package in scripts/_vendure-packages.sh:
#   1. Registers a single Trusted Publisher (GitHub Actions OIDC) for the
#      `publish_to_npm.yml` workflow, granting BOTH `--allow-publish` and
#      `--allow-stage-publish`. The workflow file decides per-job which
#      command to run: `npm stage publish` for releases (human approval
#      required), `npm publish` for nightly builds on master / minor tags.
#   2. Requires 2FA for any human/token publish (`mfa=publish`) so no
#      automation token can bypass the OIDC flow.
#
# Why a single trust entry with both flags (and not two entries split by
# GitHub environment)?
#   npm currently allows only ONE Trusted Publisher per package — see
#   https://docs.npmjs.com/trusted-publishers/ and the open feature request
#   at https://github.com/npm/documentation/issues/1755. Until that changes,
#   the security perimeter is the workflow file itself, which must be
#   protected by CODEOWNERS + branch protection (tracked separately).
#
# Idempotency:
#   Each iteration first checks for an existing trust entry, revokes it,
#   then creates the new one. Safe to re-run; will edit `@vendure/core` to
#   add the `--allow-publish` flag that it currently lacks.
#
# Usage:
#   ./scripts/npm-trust-bulk.sh           # prompts for confirmation
#   ./scripts/npm-trust-bulk.sh --yes     # skip confirmation prompt
#   ./scripts/npm-trust-bulk.sh --dry-run # plan-only, no writes
#
# Requirements: npm >= 11.15.0, logged in (`npm whoami`), 2FA enabled.
# The first `npm trust` call triggers a browser-based OTP; subsequent
# calls reuse that auth for ~5 minutes, easily enough for 15 packages.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_vendure-packages.sh
source "$SCRIPT_DIR/_vendure-packages.sh"

REPO="vendurehq/vendure"
WORKFLOW_FILE="publish_to_npm.yml"
# GitHub Actions environment the publish job runs in. Binding the trust to this
# environment means npm only accepts OIDC tokens carrying this `environment`
# claim — and GitHub only grants that claim to runs allowed by the environment's
# deployment-branch policy. The `environment:` key MUST be present on the publish
# job in publish_to_npm.yml before running this, or every publish will be rejected.
ENVIRONMENT="npm-publish"

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

echo "==> Planned action for each of ${#VENDURE_PACKAGES[@]} packages:"
echo "    if existing trust entry found: npm trust revoke <pkg> --id <id>"
echo "    npm trust github <pkg> \\"
echo "        --file $WORKFLOW_FILE \\"
echo "        --repo $REPO \\"
echo "        --environment $ENVIRONMENT \\"
echo "        --allow-publish --allow-stage-publish --yes"
echo "    npm access set mfa=publish <pkg>"
echo
echo "Packages:"
printf '  - %s\n' "${VENDURE_PACKAGES[@]}"
echo
if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "(--dry-run) No changes will be made."
  echo
fi

if [[ "$ASSUME_YES" -ne 1 ]]; then
  read -r -p "Proceed? [y/N] " reply
  if [[ ! "$reply" =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
  fi
fi

failed=()
configured=0

for pkg in "${VENDURE_PACKAGES[@]}"; do
  echo
  echo "==> $pkg"

  # Step 1: find any existing trust entry and revoke it.
  #
  # npm allows only ONE trusted publisher per package. Every @vendure/*
  # package already has a publish-only entry (from the prior OIDC setup),
  # so it must be revoked before we can create the new dual-permission one —
  # otherwise `npm trust github` fails with 409 Conflict.
  #
  # `npm trust list --json` returns a SINGLE OBJECT {id,...} when an entry
  # exists (not an array), or errors when none does. Parse defensively so
  # the script copes with object / array / wrapped shapes alike.
  #
  # NOTE: run this as a script (not `source`d into zsh). Socket Firewall is
  # wired in via a `npm='sfw npm'` zsh alias which mangles the trust API
  # endpoints; a bash subprocess does not inherit that alias, so plain npm
  # here is the real binary.
  existing_id=""
  if list_out=$(npm trust list "$pkg" --json); then
    existing_id=$(printf '%s' "$list_out" | node -e '
      let raw = "";
      try { raw = require("fs").readFileSync(0, "utf8"); } catch {}
      let id = "";
      try {
        const d = JSON.parse(raw);
        const arr = Array.isArray(d)
          ? d
          : (d && d.id ? [d]
            : (d && Array.isArray(d.trustedPublishers) ? d.trustedPublishers : []));
        if (arr.length && arr[0] && arr[0].id) id = arr[0].id;
      } catch {}
      process.stdout.write(id);
    ' 2>/dev/null || true)
  fi

  revoked=0
  if [[ -n "$existing_id" ]]; then
    echo "  - found existing trust id=$existing_id, revoking"
    if [[ "$DRY_RUN" -eq 0 ]]; then
      if ! npm trust revoke "$pkg" --id "$existing_id"; then
        echo "  ! revoke failed for $pkg" >&2
        failed+=("$pkg (revoke)")
        continue
      fi
      revoked=1
    fi
  else
    echo "  - no existing trust entry"
  fi

  # Step 2: create the new trust entry with both flags.
  #
  # npm permits only one trust entry per package, so we had to revoke before
  # creating — which means a create failure here leaves the package with NO
  # entry and CI publishing broken. Retry a few times to ride out transient
  # errors, and if it still fails after a revoke, shout loudly with recovery
  # instructions rather than burying it in the summary.
  if [[ "$DRY_RUN" -eq 0 ]]; then
    create_ok=0
    for attempt in 1 2 3; do
      if npm trust github "$pkg" \
          --file "$WORKFLOW_FILE" \
          --repo "$REPO" \
          --environment "$ENVIRONMENT" \
          --allow-publish \
          --allow-stage-publish \
          --yes; then
        create_ok=1
        break
      fi
      echo "  ! npm trust github attempt $attempt/3 failed for $pkg" >&2
      sleep 2
    done
    if [[ "$create_ok" -ne 1 ]]; then
      if [[ "$revoked" -eq 1 ]]; then
        echo "  !! BROKEN STATE: $pkg now has NO trust entry. Its previous entry was" >&2
        echo "  !! revoked but the replacement could not be created, so CI publishing" >&2
        echo "  !! for this package is broken until fixed. Re-run this script to retry," >&2
        echo "  !! or recreate manually: npm trust github $pkg --file $WORKFLOW_FILE \\" >&2
        echo "  !!   --repo $REPO --environment $ENVIRONMENT --allow-publish --allow-stage-publish" >&2
        failed+=("$pkg (trust — LEFT WITH NO ENTRY; re-run to fix)")
      else
        failed+=("$pkg (trust)")
      fi
      continue
    fi
  fi

  # Step 3: require 2FA for any token/human publish.
  if [[ "$DRY_RUN" -eq 0 ]]; then
    if ! npm access set mfa=publish "$pkg"; then
      echo "  ! npm access set mfa=publish failed for $pkg" >&2
      failed+=("$pkg (mfa)")
      continue
    fi
  fi

  configured=$((configured + 1))

  # Stay inside the 5-minute 2FA skip window without hammering the API.
  sleep 2
done

echo
echo "Configured: $configured / ${#VENDURE_PACKAGES[@]}"
if [[ ${#failed[@]} -gt 0 ]]; then
  echo "Failures:"
  printf '  - %s\n' "${failed[@]}"
  exit 1
fi

echo
echo "Verify any package with:"
echo "  npm trust list <pkg>"
echo "  npm access get mfa <pkg>"
