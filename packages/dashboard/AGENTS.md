# Dashboard Package

## Extension Compatibility: Context/Hook Separation

Never put `createContext()` and its consuming `useContext()` in the same file within `src/lib/`. Extensions dynamically import hooks from `@vendure/dashboard`, and Vite can create duplicate module instances — breaking Context identity with "must be used within a Provider" errors even when inside the provider.

Split into: context + Provider in one file, hook in `src/lib/hooks/` importing via `@/vdb/` path. Enforced by `scripts/check-lib-imports.js` on pre-commit (lint-staged). Shadcn primitives (carousel, chart, form, toggle-group) are allowlisted.

## The `@/vdb/` Path Alias

Maps to `./src/lib/*`. Projects that install the package get the pre-built bundle (`dist/bundle`, built by `vite.lib.config.mts`), where `@/vdb` and `@/graphql` imports from extensions are redirected to `@vendure/dashboard` with a deprecation warning (`vite/vite-plugin-deprecated-alias.ts`). The alias still points at the source in source mode (`VENDURE_DASHBOARD_FROM_SOURCE=true`, set by the dev-server, Storybook and this package's `vite.config.mts`). Projects get their types from `dist/types` (`npm run build:types`, which rewrites `@/vdb/*` imports in the declarations to relative paths), so they don't map `@/vdb/*`. This is why:
- Hooks in `src/lib/hooks/` must import via `@/vdb/` (not relative `../` paths)
- Never import from `@/vdb/index.js` directly — it breaks module identity for extensions

## UI Components Are External

Low-level UI primitives come from `@vendure-io/ui` (BaseUI-based), not from this repo. Don't look for or create base components like Button, Select, Dialog, etc. here.

## Single Public API: `@vendure/dashboard`

Extensions must import everything from `@vendure/dashboard` — never from third-party libraries directly. This package re-exports all components from `@vendure-io/ui`, `sonner` (toast), and other dependencies so that no implementation details leak into extension code. When adding new dependencies or components that extensions might use, always re-export them from this package's public API.

## Styling: Semantic Tokens Only

Only semantic design tokens from `@vendure-io/design-tokens` are allowed. Use Tailwind classes mapped to semantic CSS variables (e.g., `bg-background`, `text-primary`, `border-border`). Never use raw color values or non-semantic Tailwind colors.

## Select Component Gotcha

`<Select>` from `@vendure-io/ui` requires an explicit `items` prop (`Record<string, string>`) — without it, selected options won't render their label. Always pass `items={Object.fromEntries(...)}` alongside `<SelectItem>` children.

## Key Helpers (Don't Reinvent)

- **Routing**: `detailPageRouteLoader()` for detail page routes, `useDetailPage()` hook for form management. Loaders return `{ breadcrumb: ... }`.
- **Data fetching**: `api.query(document)` / `api.mutate(document)` for GraphQL. Use `useExtendedDetailQuery` / `useExtendedListQuery` for pages with extension support.
- **i18n**: Use `useLocalFormat()` hook for date/currency formatting — not `date-fns` functions directly.

## React Query Defaults

`app-providers.tsx` configures the global `QueryClient` with two non-default options that affect every `useQuery` call in the dashboard:

- `placeholderData: keepPreviousData` — keeps the last successful data on screen while a query refetches after a `queryKey` change. Eliminates blank-frame flicker on pagination, sorting, filtering, and debounced search inputs. **Opt out per-query** (`placeholderData: undefined`) when the queryKey carries identity (e.g. `['customerGroup', id]`) and showing the previous identity's data would be misleading.
- `refetchOnWindowFocus: false` — suppresses background refetches on tab focus. Polling hooks should set their own `refetchInterval` and ignore the default.

Don't flip these back unless you've thought through the flicker implications.

## Bundle and Source Modes

`vendureDashboardPlugin` serves the pre-built bundle unless `VENDURE_DASHBOARD_FROM_SOURCE=true` (see `DashboardMode` in `vite/types.ts`). In bundle mode it throws if `dist/bundle/lib.js` is missing: run `npm run build:lib`. The Playwright e2e suite builds and tests the bundle (`VITE_DASHBOARD_BUNDLE=true`), into `e2e/.dist`.

The package entry (`main`, `exports["."]`) is `dist/bundle/lib.js`, and `files` publishes only the source that bundle mode reads at runtime: `src/app/styles.css`, the `.po` catalogs and `src/lib/graphql/graphql.ts`. Source mode aliases `@vendure/dashboard` to `src/lib/index.ts`. In a project the bundle is in node_modules, where Vite doesn't discover missing dependencies, so every package the bundle imports must be in `optimizeDeps.include` (checked by `bundle-singleton.spec.ts`).

## Testing

Unit tests cover Vite plugin hooks. Run from `packages/dashboard/`.
