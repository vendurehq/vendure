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
    merge_base=$(git merge-base "$base" HEAD)
    changed=$(git diff --name-only "$merge_base" HEAD)

    # Nx decides which projects the change touches, including changes to shared
    # inputs such as the root tsconfig.json. A path list would miss those.
    affected=$(bun run nx show projects --affected --base="$merge_base" --head=HEAD)

    # Nx tracks none of these files as an input, but the package jobs read them:
    # the root scripts and the ESLint config of the boundary check.
    if [[ -n "$affected" ]] || grep -qE '^(package\.json|\.eslintrc[^/]*\.js|\.github/(workflows|actions)/)' <<< "$changed"; then
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
