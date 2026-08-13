# Source of truth for the list of published @vendure/* packages.
# Sourced by npm-trust-bulk.sh and npm-stage-approve-all.sh.
#
# Keep alphabetical; remove a package only when it has been unpublished /
# deprecated, otherwise the trust + approval scripts will skip it.

VENDURE_PACKAGES=(
  "@vendure/admin-ui"
  "@vendure/admin-ui-plugin"
  "@vendure/asset-server-plugin"
  "@vendure/cli"
  "@vendure/common"
  "@vendure/core"
  "@vendure/create"
  "@vendure/dashboard"
  "@vendure/email-plugin"
  "@vendure/graphiql-plugin"
  "@vendure/harden-plugin"
  "@vendure/job-queue-plugin"
  "@vendure/telemetry-plugin"
  "@vendure/testing"
  "@vendure/ui-devkit"
)

# --- Shared preflight helpers -------------------------------------------------
# Used by both npm-trust-bulk.sh and npm-stage-approve-all.sh so the checks
# (and their error messages) live in one place.

# Require npm >= 11.15.0 (the minimum for the `npm stage` subcommand family).
# Robust against pre-release/build suffixes: strips everything after the first
# non-digit in each numeric component before comparing.
vendure_require_npm() {
  local version major minor
  version=$(npm --version 2>/dev/null)
  major=${version%%.*}
  minor=${version#*.}; minor=${minor%%.*}
  # Strip any non-numeric suffix (e.g. "15-pre" -> "15").
  major=${major//[!0-9]/}
  minor=${minor//[!0-9]/}
  if [[ -z "$major" || -z "$minor" ]] \
     || (( major < 11 )) \
     || (( major == 11 && minor < 15 )); then
    echo "npm >= 11.15.0 required (for the 'npm stage' subcommands). Found: ${version:-unknown}" >&2
    echo "Run: npm install -g npm@latest" >&2
    return 1
  fi
}

# Require an authenticated npm session.
vendure_require_login() {
  if ! npm whoami >/dev/null 2>&1; then
    echo "Not logged into npm. Run 'npm login' first." >&2
    return 1
  fi
}
