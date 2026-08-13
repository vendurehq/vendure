# Vendure

Headless e-commerce framework. Lerna monorepo with fixed versioning.

## Development Workflow

1. Make changes to a package
2. Build it (or `bun run watch` for continuous)
3. Update `packages/dev-server/dev-config.ts` if needed
4. Restart dev server
5. Run e2e tests from the package dir

- When editing `@vendure/core`, you usually need to watch `@vendure/common` too: `bun run watch:core-common`
- The dev-server imports packages via TypeScript paths, so rebuilds are picked up on restart
- Switch DB with env var: `DB=postgres` or `DB=sqlite` before `bun run populate`

## Testing

- **E2E cache**: Seed data gets cached in `packages/<name>/e2e/__data__/`. **Delete to reset after schema changes.**

### Dashboard E2E Tests

When adding a new test, **always check existing suites first** before creating a new file:

- `catalog/product-list.spec.ts` — product list behaviour (sorting, column settings, filtering)
- `catalog/products.spec.ts` — product detail page
- `catalog/custom-fields.spec.ts` — custom field rendering, editing, persistence
- `sales/orders.spec.ts` — draft orders, order detail, order modification
- `tests/regression/` — **only** for tests that genuinely don't fit any existing suite

Add a comment referencing the issue number above the test, e.g.:
```ts
// #4393 — product list should default to sorting by updatedAt descending
test('should apply descending updatedAt sort by default', async ({ page }) => {
```

Run dashboard e2e tests from `packages/dashboard`:
```bash
CI=true VITE_TEST_PORT=5176 bunx playwright test --config e2e/playwright.config.ts <test-path> --reporter=list
```

## Commits & Branches

- Include `Fixes #ISSUE_NUMBER` in body, or `Relates to #ISSUE_NUMBER` if not a full fix
- `master` — bug fixes (default PR target)
- `minor` — new features
- `major` — breaking changes

## Gotchas

- **Dashboard stale build**: `packages/dev-server/dist/` accumulates stale Vite build artifacts across branch switches. Vite doesn't clean old hashed files, so old chunks can interfere (e.g. overwriting `window.schemaInfo`). Always `rm -rf packages/dev-server/dist` before rebuilding. Build with `bunx vite build --base /dashboard/ --outDir ../dev-server/dist` from `packages/dashboard/`. Also check no stale Vite dev server is running on port 5173 — `DashboardPlugin` auto-proxies to it instead of serving static files.
