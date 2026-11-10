#!/usr/bin/env bash

set -euo pipefail

# `nx` selects the Nx command of the build and test jobs. `affected` runs only the
# projects that the change touches. `run-many` runs all projects. Nx cannot see a
# change to a workflow or composite action, so such a change runs all projects.
if [[ "${GITHUB_EVENT_NAME:-}" == "workflow_dispatch" ]]; then
    packages=true
    dashboard=true
    nx=run-many
else
    base="${GITHUB_BASE_SHA:-}"
    if [[ -z "$base" ]]; then
        base="${GITHUB_EVENT_BEFORE:-}"
    fi
    if [[ -z "$base" || "$base" == "0000000000000000000000000000000000000000" ]]; then
        base="HEAD~1"
    fi
    changed=$(git diff --name-only "$(git merge-base "$base" HEAD)" HEAD)

    if grep -qE '^(packages/|package\.json|bun\.lock|bunfig\.toml|\.github/(workflows|actions)/)' <<< "$changed"; then
        packages=true
    else
        packages=false
    fi

    if grep -qE '^(packages/dashboard/|\.github/(workflows|actions)/)' <<< "$changed"; then
        dashboard=true
    else
        dashboard=false
    fi

    if grep -qE '^\.github/(workflows|actions)/' <<< "$changed"; then
        nx=run-many
    else
        nx=affected
    fi
fi

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    {
        echo "packages=$packages"
        echo "dashboard=$dashboard"
        echo "nx=$nx"
    } >> "$GITHUB_OUTPUT"
else
    printf 'packages=%s\ndashboard=%s\nnx=%s\n' "$packages" "$dashboard" "$nx"
fi
