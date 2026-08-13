# Dependency tracker

Tooling for the Vendure dependency-audit effort. Records the supply-chain
surface area of each published `@vendure/*` package and tracks how it shrinks
as we land each stage of the audit.

## Files

- **`snapshot.mjs`** — Walks the npm `package-lock.json` and emits per-package
  transitive-dependency counts in Markdown (default) or JSON.
- **`CHANGES.md`** — The running ledger. One section per stage with a snapshot
  and a prose description of what changed.

## Why npm lockfile (not Bun)?

Bun is the project's canonical package manager, but `bun.lock` does not encode
peer / optional / nested resolutions in a stable, walkable way. The npm v3
lockfile format is well-suited to dependency-graph analysis. We treat
`package-lock.json` as a disposable analysis artefact (gitignored) and the
script regenerates it on demand.

## Workflow per stage

```bash
# 1. (Optional but recommended) refresh the lockfile so it matches the current tree.
#    --package-lock-only is fast and does not touch node_modules.
npm install --package-lock-only

# 2. Append a Markdown snapshot to CHANGES.md.
node scripts/dependency-tracker/snapshot.mjs \
  --stage="Stage N — <short description>" \
  --append

# 3. Manually add a `### Changes` paragraph under the new snapshot describing
#    what was removed / replaced and why.

# 4. Commit CHANGES.md (and any code changes) together.
```

## Useful commands

```bash
# Preview the snapshot without writing.
node scripts/dependency-tracker/snapshot.mjs --stage="Try"

# Get a JSON snapshot for scripted diffs.
node scripts/dependency-tracker/snapshot.mjs --json > /tmp/before.json

# Compute a quick before/after delta after making changes.
node scripts/dependency-tracker/snapshot.mjs --json > /tmp/after.json
node -e "
  const b = require('/tmp/before.json'), a = require('/tmp/after.json');
  console.log('Total prod packages: ' + b.totalProdPackages + ' -> ' + a.totalProdPackages);
  for (const ap of a.perPackage) {
    const bp = b.perPackage.find(x => x.package === ap.package);
    if (!bp) continue;
    const d = ap.transitiveTotal - bp.transitiveTotal;
    if (d !== 0) console.log(ap.package + ': ' + bp.transitiveTotal + ' -> ' + ap.transitiveTotal + ' (' + (d > 0 ? '+' : '') + d + ')');
  }
"
```
