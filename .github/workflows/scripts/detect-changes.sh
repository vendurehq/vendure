#!/usr/bin/env bash

set -euo pipefail

if [[ "${GITHUB_EVENT_NAME:-}" == "workflow_dispatch" ]]; then
    packages=true
    dashboard=true
else
    base="${GITHUB_BASE_SHA:-}"
    if [[ -z "$base" ]]; then
        base="${GITHUB_EVENT_BEFORE:-}"
    fi
    if [[ -z "$base" || "$base" == "0000000000000000000000000000000000000000" ]]; then
        base="HEAD~1"
    fi
    changed=$(git diff --name-only "$(git merge-base "$base" HEAD)" HEAD)

    if printf '%s\n' "$changed" | grep -qE '^(packages/|package\.json|bun\.lock|bunfig\.toml|\.github/(workflows|actions)/)'; then
        packages=true
    else
        packages=false
    fi

    if printf '%s\n' "$changed" | grep -qE '^(packages/dashboard/|\.github/(workflows|actions)/)'; then
        dashboard=true
    else
        dashboard=false
    fi
fi

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    {
        echo "packages=$packages"
        echo "dashboard=$dashboard"
    } >> "$GITHUB_OUTPUT"
else
    printf 'packages=%s\ndashboard=%s\n' "$packages" "$dashboard"
fi
