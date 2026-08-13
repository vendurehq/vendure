# Vendure dependency audit — change log

This document tracks the dependency footprint of Vendure across the stages of the
[dependency audit effort](#issue-reference). Each stage records the state of the
dependency graph after a discrete change (or batch of changes) has landed on this
branch, so we can quantify the reduction in supply-chain surface area over time.

## Issue reference

See [#4761](https://github.com/vendurehq/vendure/issues/4761) for the full
audit assessment, rationale, and prioritised plan. This document is the
running ledger of how the dependency footprint shrinks as each stage lands.

## How to add a stage

1. Land your changes (delete a dep, swap for a built-in, vendor a package, …).
2. Regenerate the lockfile (does not touch `node_modules`):
   ```bash
   npm install --package-lock-only
   ```
3. Append a snapshot to this file:
   ```bash
   node scripts/dependency-tracker/snapshot.mjs --stage="Stage N — <short description>" --append
   ```
4. Add a short prose `### Changes` section below the snapshot explaining what
   was removed / replaced and why.
5. Commit the lockfile + this file together so the diff in `CHANGES.md` is
   reproducible.

For a machine-readable JSON snapshot (useful for scripting deltas):

```bash
node scripts/dependency-tracker/snapshot.mjs --json > /tmp/before.json
# ... make changes, regen lockfile ...
node scripts/dependency-tracker/snapshot.mjs --json > /tmp/after.json
diff /tmp/before.json /tmp/after.json
```

---

## Stage 0 — Baseline (audit start)

- **Commit:** `51b439372` on `chore/dependency-audit`
- **Date:** 2026-05-21T07:20:14.801Z
- **Total unique production packages:** 1880

### Per-Vendure-package transitive footprint

| Package | Direct deps | Unique transitive (prod) |
|---------|-------------|--------------------------|
| `@vendure/core` | 41 | 453 |
| `@vendure/common` | 0 | 0 |
| `@vendure/email-plugin` | 7 | 290 |
| `@vendure/asset-server-plugin` | 3 | 20 |
| `@vendure/admin-ui-plugin` | 3 | 71 |
| `@vendure/telemetry-plugin` | 9 | 162 |
| `@vendure/harden-plugin` | 2 | 153 |
| `@vendure/job-queue-plugin` | 2 | 23 |
| `@vendure/graphiql-plugin` | 1 | 65 |
| `@vendure/testing` | 8 | 34 |
| `@vendure/cli` | 11 | 92 |
| `@vendure/create` | 11 | 46 |
| `@vendure/dashboard` | 67 | 838 |
| `@vendure/ui-devkit` | 11 | 810 |
| `@vendure/admin-ui` | 48 | 115 |

<details>
<summary>Per-direct-dep transitive counts (click to expand)</summary>

#### `@vendure/core`

| Direct dep | Transitive count |
|-----------|------------------|
| `@nestjs/terminus` | 295 |
| `@nestjs/typeorm` | 260 |
| `@nestjs/apollo` | 237 |
| `typeorm` | 186 |
| `@apollo/server` | 151 |
| `@nestjs/graphql` | 149 |
| `@nestjs/core` | 102 |
| `@nestjs/platform-express` | 102 |
| `express` | 65 |
| `body-parser` | 41 |
| `graphql-upload` | 32 |
| `http-proxy-middleware` | 19 |
| `@nestjs/common` | 18 |
| `@graphql-tools/stitch` | 17 |
| `ioredis` | 11 |
| `cookie-session` | 9 |
| `i18next-icu` | 9 |
| `intl-messageformat` | 8 |
| `fs-extra` | 4 |
| `bcrypt` | 3 |
| `graphql-scalars` | 3 |
| `graphql-tag` | 3 |
| `i18next` | 3 |
| `mime-types` | 2 |
| `rxjs` | 2 |
| `@vendure/common` | 1 |
| `cron-time-generator` | 1 |
| `croner` | 1 |
| `cronstrue` | 1 |
| `csv-parse` | 1 |
| `graphql` | 1 |
| `graphql-fields` | 1 |
| `i18next-fs-backend` | 1 |
| `i18next-http-middleware` | 1 |
| `image-size` | 1 |
| `ms` | 1 |
| `nanoid` | 1 |
| `picocolors` | 1 |
| `progress` | 1 |
| `reflect-metadata` | 1 |
| `semver` | 1 |

#### `@vendure/email-plugin`

| Direct dep | Transitive count |
|-----------|------------------|
| `mjml` | 140 |
| `@types/nodemailer` | 77 |
| `express` | 65 |
| `handlebars` | 6 |
| `fs-extra` | 4 |
| `dateformat` | 1 |
| `nodemailer` | 1 |

#### `@vendure/asset-server-plugin`

| Direct dep | Transitive count |
|-----------|------------------|
| `file-type` | 10 |
| `sharp` | 6 |
| `fs-extra` | 4 |

#### `@vendure/admin-ui-plugin`

| Direct dep | Transitive count |
|-----------|------------------|
| `express-rate-limit` | 66 |
| `fs-extra` | 4 |
| `date-fns` | 1 |

#### `@vendure/telemetry-plugin`

| Direct dep | Transitive count |
|-----------|------------------|
| `@opentelemetry/auto-instrumentations-node` | 161 |
| `@opentelemetry/sdk-node` | 78 |
| `@opentelemetry/exporter-logs-otlp-proto` | 25 |
| `@opentelemetry/exporter-trace-otlp-http` | 25 |
| `@opentelemetry/sdk-logs` | 6 |
| `@opentelemetry/resources` | 4 |
| `@opentelemetry/context-async-hooks` | 2 |
| `@opentelemetry/api` | 1 |
| `javascript-stringify` | 1 |

#### `@vendure/harden-plugin`

| Direct dep | Transitive count |
|-----------|------------------|
| `@apollo/server` | 151 |
| `graphql-query-complexity` | 3 |

#### `@vendure/job-queue-plugin`

| Direct dep | Transitive count |
|-----------|------------------|
| `bullmq` | 23 |
| `ioredis` | 11 |

#### `@vendure/graphiql-plugin`

| Direct dep | Transitive count |
|-----------|------------------|
| `express` | 65 |

#### `@vendure/testing`

| Direct dep | Transitive count |
|-----------|------------------|
| `form-data` | 20 |
| `node-fetch` | 7 |
| `graphql-tag` | 3 |
| `@graphql-typed-document-node/core` | 2 |
| `@vendure/common` | 1 |
| `faker` | 1 |
| `graphql` | 1 |
| `sql.js` | 1 |

#### `@vendure/cli`

| Direct dep | Transitive count |
|-----------|------------------|
| `ts-node` | 35 |
| `ts-morph` | 26 |
| `change-case` | 16 |
| `@clack/prompts` | 4 |
| `fs-extra` | 4 |
| `tsconfig-paths` | 4 |
| `@vendure/common` | 1 |
| `commander` | 1 |
| `dotenv` | 1 |
| `picocolors` | 1 |
| `strip-json-comments` | 1 |

#### `@vendure/create`

| Direct dep | Transitive count |
|-----------|------------------|
| `open` | 10 |
| `tcp-port-used` | 7 |
| `cross-spawn` | 6 |
| `handlebars` | 6 |
| `tar` | 6 |
| `@clack/prompts` | 4 |
| `fs-extra` | 4 |
| `@vendure/common` | 1 |
| `commander` | 1 |
| `picocolors` | 1 |
| `semver` | 1 |

#### `@vendure/dashboard`

| Direct dep | Transitive count |
|-----------|------------------|
| `@vendure-io/ui` | 424 |
| `@vendure-io/design-tokens` | 325 |
| `@lingui/vite-plugin` | 281 |
| `@tanstack/router-plugin` | 261 |
| `@lingui/cli` | 191 |
| `@vitejs/plugin-react` | 175 |
| `@tailwindcss/vite` | 141 |
| `vite` | 132 |
| `@tanstack/eslint-plugin-query` | 113 |
| `@lingui/react` | 87 |
| `@lingui/babel-plugin-lingui-macro` | 85 |
| `@lingui/core` | 85 |
| `express-rate-limit` | 66 |
| `@tiptap/starter-kit` | 60 |
| `@babel/preset-typescript` | 51 |
| `@tiptap/react` | 51 |
| `@babel/preset-react` | 47 |
| `recharts` | 44 |
| `@tiptap/extension-floating-menu` | 40 |
| `@babel/core` | 39 |
| `@tiptap/extension-placeholder` | 38 |
| `@tiptap/extension-image` | 37 |
| `@tiptap/extension-table` | 37 |
| `@tiptap/extension-text-style` | 37 |
| `@tiptap/pm` | 35 |
| `vaul` | 33 |
| `@tanstack/router-devtools` | 21 |
| `fast-glob` | 18 |
| `@tanstack/react-router` | 15 |
| `react-dropzone` | 10 |
| `@dnd-kit/modifiers` | 8 |
| `@dnd-kit/sortable` | 8 |
| `motion` | 8 |
| `@dnd-kit/core` | 7 |
| `gql.tada` | 7 |
| `react-day-picker` | 6 |
| `@tanstack/react-query-devtools` | 5 |
| `@tanstack/react-table` | 5 |
| `@hookform/resolvers` | 4 |
| `@uidotdev/usehooks` | 4 |
| `fs-extra` | 4 |
| `input-otp` | 4 |
| `json-edit-react` | 4 |
| `next-themes` | 4 |
| `sonner` | 4 |
| `tsconfig-paths` | 4 |
| `@tanstack/react-query` | 3 |
| `@types/react-dom` | 3 |
| `react-dom` | 3 |
| `@types/react` | 2 |
| `acorn-walk` | 2 |
| `lucide-react` | 2 |
| `react-hook-form` | 2 |
| `@fontsource-variable/geist-mono` | 1 |
| `@fontsource-variable/inter` | 1 |
| `@fontsource-variable/public-sans` | 1 |
| `acorn` | 1 |
| `awesome-graphql-client` | 1 |
| `clsx` | 1 |
| `date-fns` | 1 |
| `graphql` | 1 |
| `react` | 1 |
| `strip-json-comments` | 1 |
| `tailwind-merge` | 1 |
| `tailwindcss` | 1 |
| `tw-animate-css` | 1 |
| `zod` | 1 |

#### `@vendure/ui-devkit`

| Direct dep | Transitive count |
|-----------|------------------|
| `@angular-devkit/build-angular` | 705 |
| `@angular/cli` | 221 |
| `@angular/compiler-cli` | 62 |
| `chokidar` | 15 |
| `glob` | 8 |
| `chalk` | 6 |
| `fs-extra` | 4 |
| `@angular/compiler` | 2 |
| `rxjs` | 2 |
| `@vendure/admin-ui` | 1 |
| `@vendure/common` | 1 |

#### `@vendure/admin-ui`

| Direct dep | Transitive count |
|-----------|------------------|
| `apollo-angular` | 36 |
| `apollo-upload-client` | 35 |
| `@apollo/client` | 32 |
| `@clr/angular` | 20 |
| `ngx-translate-messageformat-compiler` | 16 |
| `@clr/core` | 14 |
| `@clr/ui` | 12 |
| `@cds/core` | 11 |
| `prosemirror-menu` | 10 |
| `@angular/platform-browser-dynamic` | 9 |
| `@ng-select/ng-select` | 9 |
| `@angular/cdk` | 8 |
| `@angular/forms` | 8 |
| `@angular/router` | 8 |
| `@messageformat/core` | 8 |
| `prosemirror-gapcursor` | 8 |
| `prosemirror-tables` | 8 |
| `@angular/platform-browser` | 7 |
| `prosemirror-history` | 7 |
| `prosemirror-keymap` | 7 |
| `@angular/animations` | 6 |
| `@ngx-translate/core` | 6 |
| `@ngx-translate/http-loader` | 6 |
| `ngx-pagination` | 6 |
| `prosemirror-commands` | 6 |
| `prosemirror-dropcursor` | 6 |
| `prosemirror-inputrules` | 6 |
| `prosemirror-schema-list` | 6 |
| `@angular/common` | 5 |
| `messageformat` | 5 |
| `prosemirror-state` | 5 |
| `@angular/core` | 4 |
| `prosemirror-schema-basic` | 3 |
| `react-dom` | 3 |
| `@biesbjerg/ngx-translate-extract-marker` | 2 |
| `@clr/icons` | 2 |
| `rxjs` | 2 |
| `@angular/language-service` | 1 |
| `@vendure/common` | 1 |
| `@webcomponents/custom-elements` | 1 |
| `chartist` | 1 |
| `codejar` | 1 |
| `dayjs` | 1 |
| `graphql` | 1 |
| `just-extend` | 1 |
| `react` | 1 |
| `tslib` | 1 |
| `zone.js` | 1 |

</details>

## Stage 1 — @types/nodemailer: pick up upstream AWS SDK removal

- **Commit:** `905ec160a` on `chore/dependency-audit`
- **Date:** 2026-05-21T07:50:42.183Z
- **Total unique production packages:** 1807

### Per-Vendure-package transitive footprint

| Package | Direct deps | Unique transitive (prod) |
|---------|-------------|--------------------------|
| `@vendure/core` | 41 | 453 |
| `@vendure/common` | 0 | 0 |
| `@vendure/email-plugin` | 7 | 216 |
| `@vendure/asset-server-plugin` | 3 | 20 |
| `@vendure/admin-ui-plugin` | 3 | 71 |
| `@vendure/telemetry-plugin` | 9 | 162 |
| `@vendure/harden-plugin` | 2 | 153 |
| `@vendure/job-queue-plugin` | 2 | 23 |
| `@vendure/graphiql-plugin` | 1 | 65 |
| `@vendure/testing` | 8 | 34 |
| `@vendure/cli` | 11 | 92 |
| `@vendure/create` | 11 | 46 |
| `@vendure/dashboard` | 67 | 838 |
| `@vendure/ui-devkit` | 11 | 810 |
| `@vendure/admin-ui` | 48 | 115 |

<details>
<summary>Per-direct-dep transitive counts (click to expand)</summary>

#### `@vendure/core`

| Direct dep | Transitive count |
|-----------|------------------|
| `@nestjs/terminus` | 295 |
| `@nestjs/typeorm` | 260 |
| `@nestjs/apollo` | 237 |
| `typeorm` | 186 |
| `@apollo/server` | 151 |
| `@nestjs/graphql` | 149 |
| `@nestjs/core` | 102 |
| `@nestjs/platform-express` | 102 |
| `express` | 65 |
| `body-parser` | 41 |
| `graphql-upload` | 32 |
| `http-proxy-middleware` | 19 |
| `@nestjs/common` | 18 |
| `@graphql-tools/stitch` | 17 |
| `ioredis` | 11 |
| `cookie-session` | 9 |
| `i18next-icu` | 9 |
| `intl-messageformat` | 8 |
| `fs-extra` | 4 |
| `bcrypt` | 3 |
| `graphql-scalars` | 3 |
| `graphql-tag` | 3 |
| `i18next` | 3 |
| `mime-types` | 2 |
| `rxjs` | 2 |
| `@vendure/common` | 1 |
| `cron-time-generator` | 1 |
| `croner` | 1 |
| `cronstrue` | 1 |
| `csv-parse` | 1 |
| `graphql` | 1 |
| `graphql-fields` | 1 |
| `i18next-fs-backend` | 1 |
| `i18next-http-middleware` | 1 |
| `image-size` | 1 |
| `ms` | 1 |
| `nanoid` | 1 |
| `picocolors` | 1 |
| `progress` | 1 |
| `reflect-metadata` | 1 |
| `semver` | 1 |

#### `@vendure/email-plugin`

| Direct dep | Transitive count |
|-----------|------------------|
| `mjml` | 140 |
| `express` | 65 |
| `handlebars` | 6 |
| `fs-extra` | 4 |
| `@types/nodemailer` | 3 |
| `dateformat` | 1 |
| `nodemailer` | 1 |

#### `@vendure/asset-server-plugin`

| Direct dep | Transitive count |
|-----------|------------------|
| `file-type` | 10 |
| `sharp` | 6 |
| `fs-extra` | 4 |

#### `@vendure/admin-ui-plugin`

| Direct dep | Transitive count |
|-----------|------------------|
| `express-rate-limit` | 66 |
| `fs-extra` | 4 |
| `date-fns` | 1 |

#### `@vendure/telemetry-plugin`

| Direct dep | Transitive count |
|-----------|------------------|
| `@opentelemetry/auto-instrumentations-node` | 161 |
| `@opentelemetry/sdk-node` | 78 |
| `@opentelemetry/exporter-logs-otlp-proto` | 25 |
| `@opentelemetry/exporter-trace-otlp-http` | 25 |
| `@opentelemetry/sdk-logs` | 6 |
| `@opentelemetry/resources` | 4 |
| `@opentelemetry/context-async-hooks` | 2 |
| `@opentelemetry/api` | 1 |
| `javascript-stringify` | 1 |

#### `@vendure/harden-plugin`

| Direct dep | Transitive count |
|-----------|------------------|
| `@apollo/server` | 151 |
| `graphql-query-complexity` | 3 |

#### `@vendure/job-queue-plugin`

| Direct dep | Transitive count |
|-----------|------------------|
| `bullmq` | 23 |
| `ioredis` | 11 |

#### `@vendure/graphiql-plugin`

| Direct dep | Transitive count |
|-----------|------------------|
| `express` | 65 |

#### `@vendure/testing`

| Direct dep | Transitive count |
|-----------|------------------|
| `form-data` | 20 |
| `node-fetch` | 7 |
| `graphql-tag` | 3 |
| `@graphql-typed-document-node/core` | 2 |
| `@vendure/common` | 1 |
| `faker` | 1 |
| `graphql` | 1 |
| `sql.js` | 1 |

#### `@vendure/cli`

| Direct dep | Transitive count |
|-----------|------------------|
| `ts-node` | 35 |
| `ts-morph` | 26 |
| `change-case` | 16 |
| `@clack/prompts` | 4 |
| `fs-extra` | 4 |
| `tsconfig-paths` | 4 |
| `@vendure/common` | 1 |
| `commander` | 1 |
| `dotenv` | 1 |
| `picocolors` | 1 |
| `strip-json-comments` | 1 |

#### `@vendure/create`

| Direct dep | Transitive count |
|-----------|------------------|
| `open` | 10 |
| `tcp-port-used` | 7 |
| `cross-spawn` | 6 |
| `handlebars` | 6 |
| `tar` | 6 |
| `@clack/prompts` | 4 |
| `fs-extra` | 4 |
| `@vendure/common` | 1 |
| `commander` | 1 |
| `picocolors` | 1 |
| `semver` | 1 |

#### `@vendure/dashboard`

| Direct dep | Transitive count |
|-----------|------------------|
| `@vendure-io/ui` | 424 |
| `@vendure-io/design-tokens` | 325 |
| `@lingui/vite-plugin` | 281 |
| `@tanstack/router-plugin` | 261 |
| `@lingui/cli` | 191 |
| `@vitejs/plugin-react` | 175 |
| `@tailwindcss/vite` | 141 |
| `vite` | 132 |
| `@tanstack/eslint-plugin-query` | 113 |
| `@lingui/react` | 87 |
| `@lingui/babel-plugin-lingui-macro` | 85 |
| `@lingui/core` | 85 |
| `express-rate-limit` | 66 |
| `@tiptap/starter-kit` | 60 |
| `@babel/preset-typescript` | 51 |
| `@tiptap/react` | 51 |
| `@babel/preset-react` | 47 |
| `recharts` | 44 |
| `@tiptap/extension-floating-menu` | 40 |
| `@babel/core` | 39 |
| `@tiptap/extension-placeholder` | 38 |
| `@tiptap/extension-image` | 37 |
| `@tiptap/extension-table` | 37 |
| `@tiptap/extension-text-style` | 37 |
| `@tiptap/pm` | 35 |
| `vaul` | 33 |
| `@tanstack/router-devtools` | 21 |
| `fast-glob` | 18 |
| `@tanstack/react-router` | 15 |
| `react-dropzone` | 10 |
| `@dnd-kit/modifiers` | 8 |
| `@dnd-kit/sortable` | 8 |
| `motion` | 8 |
| `@dnd-kit/core` | 7 |
| `gql.tada` | 7 |
| `react-day-picker` | 6 |
| `@tanstack/react-query-devtools` | 5 |
| `@tanstack/react-table` | 5 |
| `@hookform/resolvers` | 4 |
| `@uidotdev/usehooks` | 4 |
| `fs-extra` | 4 |
| `input-otp` | 4 |
| `json-edit-react` | 4 |
| `next-themes` | 4 |
| `sonner` | 4 |
| `tsconfig-paths` | 4 |
| `@tanstack/react-query` | 3 |
| `@types/react-dom` | 3 |
| `react-dom` | 3 |
| `@types/react` | 2 |
| `acorn-walk` | 2 |
| `lucide-react` | 2 |
| `react-hook-form` | 2 |
| `@fontsource-variable/geist-mono` | 1 |
| `@fontsource-variable/inter` | 1 |
| `@fontsource-variable/public-sans` | 1 |
| `acorn` | 1 |
| `awesome-graphql-client` | 1 |
| `clsx` | 1 |
| `date-fns` | 1 |
| `graphql` | 1 |
| `react` | 1 |
| `strip-json-comments` | 1 |
| `tailwind-merge` | 1 |
| `tailwindcss` | 1 |
| `tw-animate-css` | 1 |
| `zod` | 1 |

#### `@vendure/ui-devkit`

| Direct dep | Transitive count |
|-----------|------------------|
| `@angular-devkit/build-angular` | 705 |
| `@angular/cli` | 221 |
| `@angular/compiler-cli` | 62 |
| `chokidar` | 15 |
| `glob` | 8 |
| `chalk` | 6 |
| `fs-extra` | 4 |
| `@angular/compiler` | 2 |
| `rxjs` | 2 |
| `@vendure/admin-ui` | 1 |
| `@vendure/common` | 1 |

#### `@vendure/admin-ui`

| Direct dep | Transitive count |
|-----------|------------------|
| `apollo-angular` | 36 |
| `apollo-upload-client` | 35 |
| `@apollo/client` | 32 |
| `@clr/angular` | 20 |
| `ngx-translate-messageformat-compiler` | 16 |
| `@clr/core` | 14 |
| `@clr/ui` | 12 |
| `@cds/core` | 11 |
| `prosemirror-menu` | 10 |
| `@angular/platform-browser-dynamic` | 9 |
| `@ng-select/ng-select` | 9 |
| `@angular/cdk` | 8 |
| `@angular/forms` | 8 |
| `@angular/router` | 8 |
| `@messageformat/core` | 8 |
| `prosemirror-gapcursor` | 8 |
| `prosemirror-tables` | 8 |
| `@angular/platform-browser` | 7 |
| `prosemirror-history` | 7 |
| `prosemirror-keymap` | 7 |
| `@angular/animations` | 6 |
| `@ngx-translate/core` | 6 |
| `@ngx-translate/http-loader` | 6 |
| `ngx-pagination` | 6 |
| `prosemirror-commands` | 6 |
| `prosemirror-dropcursor` | 6 |
| `prosemirror-inputrules` | 6 |
| `prosemirror-schema-list` | 6 |
| `@angular/common` | 5 |
| `messageformat` | 5 |
| `prosemirror-state` | 5 |
| `@angular/core` | 4 |
| `prosemirror-schema-basic` | 3 |
| `react-dom` | 3 |
| `@biesbjerg/ngx-translate-extract-marker` | 2 |
| `@clr/icons` | 2 |
| `rxjs` | 2 |
| `@angular/language-service` | 1 |
| `@vendure/common` | 1 |
| `@webcomponents/custom-elements` | 1 |
| `chartist` | 1 |
| `codejar` | 1 |
| `dayjs` | 1 |
| `graphql` | 1 |
| `just-extend` | 1 |
| `react` | 1 |
| `tslib` | 1 |
| `zone.js` | 1 |

</details>

### Changes

Bumped `@types/nodemailer` from `^6.4.9` to `^6.4.22` in both
`packages/email-plugin/package.json` and the workspace root `package.json`
(used by `dev-server` to satisfy `EmailPlugin` type resolution).

**Why:** `@types/nodemailer` versions `6.4.19` through `6.4.21` declared
`@aws-sdk/client-ses` as a runtime `dependencies` entry, pulling ~76 AWS SDK
and Smithy packages into every install that resolved the types — even
consumers who never touch SES. This was a regression introduced upstream in
DefinitelyTyped [PR #73297](https://github.com/DefinitelyTyped/DefinitelyTyped/pull/73297)
and flagged on
[discussion #74080](https://github.com/DefinitelyTyped/DefinitelyTyped/discussions/74080)
on 2025-11-14 — citing "the latest security issues on NPMJS" as the same
supply-chain motivation that prompted our audit.

The fix landed upstream as DefinitelyTyped
[PR #74249](https://github.com/DefinitelyTyped/DefinitelyTyped/pull/74249)
("Remove AWS SDK from dependencies, use structural types") and shipped to npm
as `@types/nodemailer@6.4.22` on 2026-01-26. Our existing spec floor of
`^6.4.9` already permitted it; the lockfile had simply never been refreshed
since. Bumping the floor to `^6.4.22` makes the fix mandatory and prevents a
future refresh from silently regressing back to 6.4.21.

**Caveat for future bumps:** the `7.0.x` line of `@types/nodemailer` still
carries `@aws-sdk/client-sesv2` as a runtime dep — the structural-types fix
was backported to v6 and forward-ported to v8, but not to v7. Stay on v6 (or
jump straight to v8) to keep the install clean.

**Results:**

| Metric | Before | After | Δ |
|---|---:|---:|---:|
| Total unique prod packages (repo-wide) | 1,880 | 1,807 | **−73** |
| `@vendure/email-plugin` transitive (prod) | 290 | 216 | **−74** |
| `@types/nodemailer` subtree | 77 | 3 | **−74** |

## Stage 2 — Remove body-parser direct dep from @vendure/core

- **Commit:** `ca3d09390` on `chore/dependency-audit`
- **Date:** 2026-05-21T08:18:00.680Z
- **Total unique production packages:** 1807

### Per-Vendure-package transitive footprint

| Package | Direct deps | Unique transitive (prod) |
|---------|-------------|--------------------------|
| `@vendure/core` | 40 | 453 |
| `@vendure/common` | 0 | 0 |
| `@vendure/email-plugin` | 7 | 216 |
| `@vendure/asset-server-plugin` | 3 | 20 |
| `@vendure/admin-ui-plugin` | 3 | 71 |
| `@vendure/telemetry-plugin` | 9 | 162 |
| `@vendure/harden-plugin` | 2 | 153 |
| `@vendure/job-queue-plugin` | 2 | 23 |
| `@vendure/graphiql-plugin` | 1 | 65 |
| `@vendure/testing` | 8 | 34 |
| `@vendure/cli` | 11 | 92 |
| `@vendure/create` | 11 | 46 |
| `@vendure/dashboard` | 67 | 838 |
| `@vendure/ui-devkit` | 11 | 810 |
| `@vendure/admin-ui` | 48 | 115 |

<details>
<summary>Per-direct-dep transitive counts (click to expand)</summary>

#### `@vendure/core`

| Direct dep | Transitive count |
|-----------|------------------|
| `@nestjs/terminus` | 295 |
| `@nestjs/typeorm` | 260 |
| `@nestjs/apollo` | 237 |
| `typeorm` | 186 |
| `@apollo/server` | 151 |
| `@nestjs/graphql` | 149 |
| `@nestjs/core` | 102 |
| `@nestjs/platform-express` | 102 |
| `express` | 65 |
| `graphql-upload` | 32 |
| `http-proxy-middleware` | 19 |
| `@nestjs/common` | 18 |
| `@graphql-tools/stitch` | 17 |
| `ioredis` | 11 |
| `cookie-session` | 9 |
| `i18next-icu` | 9 |
| `intl-messageformat` | 8 |
| `fs-extra` | 4 |
| `bcrypt` | 3 |
| `graphql-scalars` | 3 |
| `graphql-tag` | 3 |
| `i18next` | 3 |
| `mime-types` | 2 |
| `rxjs` | 2 |
| `@vendure/common` | 1 |
| `cron-time-generator` | 1 |
| `croner` | 1 |
| `cronstrue` | 1 |
| `csv-parse` | 1 |
| `graphql` | 1 |
| `graphql-fields` | 1 |
| `i18next-fs-backend` | 1 |
| `i18next-http-middleware` | 1 |
| `image-size` | 1 |
| `ms` | 1 |
| `nanoid` | 1 |
| `picocolors` | 1 |
| `progress` | 1 |
| `reflect-metadata` | 1 |
| `semver` | 1 |

#### `@vendure/email-plugin`

| Direct dep | Transitive count |
|-----------|------------------|
| `mjml` | 140 |
| `express` | 65 |
| `handlebars` | 6 |
| `fs-extra` | 4 |
| `@types/nodemailer` | 3 |
| `dateformat` | 1 |
| `nodemailer` | 1 |

#### `@vendure/asset-server-plugin`

| Direct dep | Transitive count |
|-----------|------------------|
| `file-type` | 10 |
| `sharp` | 6 |
| `fs-extra` | 4 |

#### `@vendure/admin-ui-plugin`

| Direct dep | Transitive count |
|-----------|------------------|
| `express-rate-limit` | 66 |
| `fs-extra` | 4 |
| `date-fns` | 1 |

#### `@vendure/telemetry-plugin`

| Direct dep | Transitive count |
|-----------|------------------|
| `@opentelemetry/auto-instrumentations-node` | 161 |
| `@opentelemetry/sdk-node` | 78 |
| `@opentelemetry/exporter-logs-otlp-proto` | 25 |
| `@opentelemetry/exporter-trace-otlp-http` | 25 |
| `@opentelemetry/sdk-logs` | 6 |
| `@opentelemetry/resources` | 4 |
| `@opentelemetry/context-async-hooks` | 2 |
| `@opentelemetry/api` | 1 |
| `javascript-stringify` | 1 |

#### `@vendure/harden-plugin`

| Direct dep | Transitive count |
|-----------|------------------|
| `@apollo/server` | 151 |
| `graphql-query-complexity` | 3 |

#### `@vendure/job-queue-plugin`

| Direct dep | Transitive count |
|-----------|------------------|
| `bullmq` | 23 |
| `ioredis` | 11 |

#### `@vendure/graphiql-plugin`

| Direct dep | Transitive count |
|-----------|------------------|
| `express` | 65 |

#### `@vendure/testing`

| Direct dep | Transitive count |
|-----------|------------------|
| `form-data` | 20 |
| `node-fetch` | 7 |
| `graphql-tag` | 3 |
| `@graphql-typed-document-node/core` | 2 |
| `@vendure/common` | 1 |
| `faker` | 1 |
| `graphql` | 1 |
| `sql.js` | 1 |

#### `@vendure/cli`

| Direct dep | Transitive count |
|-----------|------------------|
| `ts-node` | 35 |
| `ts-morph` | 26 |
| `change-case` | 16 |
| `@clack/prompts` | 4 |
| `fs-extra` | 4 |
| `tsconfig-paths` | 4 |
| `@vendure/common` | 1 |
| `commander` | 1 |
| `dotenv` | 1 |
| `picocolors` | 1 |
| `strip-json-comments` | 1 |

#### `@vendure/create`

| Direct dep | Transitive count |
|-----------|------------------|
| `open` | 10 |
| `tcp-port-used` | 7 |
| `cross-spawn` | 6 |
| `handlebars` | 6 |
| `tar` | 6 |
| `@clack/prompts` | 4 |
| `fs-extra` | 4 |
| `@vendure/common` | 1 |
| `commander` | 1 |
| `picocolors` | 1 |
| `semver` | 1 |

#### `@vendure/dashboard`

| Direct dep | Transitive count |
|-----------|------------------|
| `@vendure-io/ui` | 424 |
| `@vendure-io/design-tokens` | 325 |
| `@lingui/vite-plugin` | 281 |
| `@tanstack/router-plugin` | 261 |
| `@lingui/cli` | 191 |
| `@vitejs/plugin-react` | 175 |
| `@tailwindcss/vite` | 141 |
| `vite` | 132 |
| `@tanstack/eslint-plugin-query` | 113 |
| `@lingui/react` | 87 |
| `@lingui/babel-plugin-lingui-macro` | 85 |
| `@lingui/core` | 85 |
| `express-rate-limit` | 66 |
| `@tiptap/starter-kit` | 60 |
| `@babel/preset-typescript` | 51 |
| `@tiptap/react` | 51 |
| `@babel/preset-react` | 47 |
| `recharts` | 44 |
| `@tiptap/extension-floating-menu` | 40 |
| `@babel/core` | 39 |
| `@tiptap/extension-placeholder` | 38 |
| `@tiptap/extension-image` | 37 |
| `@tiptap/extension-table` | 37 |
| `@tiptap/extension-text-style` | 37 |
| `@tiptap/pm` | 35 |
| `vaul` | 33 |
| `@tanstack/router-devtools` | 21 |
| `fast-glob` | 18 |
| `@tanstack/react-router` | 15 |
| `react-dropzone` | 10 |
| `@dnd-kit/modifiers` | 8 |
| `@dnd-kit/sortable` | 8 |
| `motion` | 8 |
| `@dnd-kit/core` | 7 |
| `gql.tada` | 7 |
| `react-day-picker` | 6 |
| `@tanstack/react-query-devtools` | 5 |
| `@tanstack/react-table` | 5 |
| `@hookform/resolvers` | 4 |
| `@uidotdev/usehooks` | 4 |
| `fs-extra` | 4 |
| `input-otp` | 4 |
| `json-edit-react` | 4 |
| `next-themes` | 4 |
| `sonner` | 4 |
| `tsconfig-paths` | 4 |
| `@tanstack/react-query` | 3 |
| `@types/react-dom` | 3 |
| `react-dom` | 3 |
| `@types/react` | 2 |
| `acorn-walk` | 2 |
| `lucide-react` | 2 |
| `react-hook-form` | 2 |
| `@fontsource-variable/geist-mono` | 1 |
| `@fontsource-variable/inter` | 1 |
| `@fontsource-variable/public-sans` | 1 |
| `acorn` | 1 |
| `awesome-graphql-client` | 1 |
| `clsx` | 1 |
| `date-fns` | 1 |
| `graphql` | 1 |
| `react` | 1 |
| `strip-json-comments` | 1 |
| `tailwind-merge` | 1 |
| `tailwindcss` | 1 |
| `tw-animate-css` | 1 |
| `zod` | 1 |

#### `@vendure/ui-devkit`

| Direct dep | Transitive count |
|-----------|------------------|
| `@angular-devkit/build-angular` | 705 |
| `@angular/cli` | 221 |
| `@angular/compiler-cli` | 62 |
| `chokidar` | 15 |
| `glob` | 8 |
| `chalk` | 6 |
| `fs-extra` | 4 |
| `@angular/compiler` | 2 |
| `rxjs` | 2 |
| `@vendure/admin-ui` | 1 |
| `@vendure/common` | 1 |

#### `@vendure/admin-ui`

| Direct dep | Transitive count |
|-----------|------------------|
| `apollo-angular` | 36 |
| `apollo-upload-client` | 35 |
| `@apollo/client` | 32 |
| `@clr/angular` | 20 |
| `ngx-translate-messageformat-compiler` | 16 |
| `@clr/core` | 14 |
| `@clr/ui` | 12 |
| `@cds/core` | 11 |
| `prosemirror-menu` | 10 |
| `@angular/platform-browser-dynamic` | 9 |
| `@ng-select/ng-select` | 9 |
| `@angular/cdk` | 8 |
| `@angular/forms` | 8 |
| `@angular/router` | 8 |
| `@messageformat/core` | 8 |
| `prosemirror-gapcursor` | 8 |
| `prosemirror-tables` | 8 |
| `@angular/platform-browser` | 7 |
| `prosemirror-history` | 7 |
| `prosemirror-keymap` | 7 |
| `@angular/animations` | 6 |
| `@ngx-translate/core` | 6 |
| `@ngx-translate/http-loader` | 6 |
| `ngx-pagination` | 6 |
| `prosemirror-commands` | 6 |
| `prosemirror-dropcursor` | 6 |
| `prosemirror-inputrules` | 6 |
| `prosemirror-schema-list` | 6 |
| `@angular/common` | 5 |
| `messageformat` | 5 |
| `prosemirror-state` | 5 |
| `@angular/core` | 4 |
| `prosemirror-schema-basic` | 3 |
| `react-dom` | 3 |
| `@biesbjerg/ngx-translate-extract-marker` | 2 |
| `@clr/icons` | 2 |
| `rxjs` | 2 |
| `@angular/language-service` | 1 |
| `@vendure/common` | 1 |
| `@webcomponents/custom-elements` | 1 |
| `chartist` | 1 |
| `codejar` | 1 |
| `dayjs` | 1 |
| `graphql` | 1 |
| `just-extend` | 1 |
| `react` | 1 |
| `tslib` | 1 |
| `zone.js` | 1 |

</details>

### Changes

Removed `body-parser` from `@vendure/core/package.json` and updated the
documented user-facing pattern in `packages/core/src/common/types/common-types.ts`
(JSDoc on the `Middleware` interface) to recommend `import { json } from 'express'`
instead of `import { json } from 'body-parser'`. Regenerated
`docs/docs/reference/typescript-api/common/middleware.mdx` from the new JSDoc.

**Why:** `body-parser` was declared as a direct dependency of `@vendure/core`
but never imported in source. Its only references were in JSDoc / generated
docs telling users to use `import { json } from 'body-parser'` to override
the JSON payload size limit. The JSDoc text *"Vendure relies on the
body-parser middleware to parse incoming JSON data"* was true under the
Express 4 / older NestJS stack but became inaccurate after the
Express 5 / NestJS 11 / Apollo Server v5 upgrade — Vendure now relies on
Express 5's built-in JSON parser, which re-exports body-parser v2 directly
(`exports.json = bodyParser.json` in `node_modules/express/lib/express.js`).
The documented `express.json()` is byte-identical in behaviour to
`body-parser.json()`.

**Honest impact assessment.** The repo-wide unique-package count did **not**
move:

| Metric | Stage 1 | Stage 2 | Δ |
|---|---:|---:|---:|
| Total unique prod packages (repo-wide) | 1,807 | 1,807 | 0 |
| `@vendure/core` direct dep count | 41 | 40 | **−1** |
| `@vendure/core` transitive union (prod) | 453 | 453 | 0 |

`body-parser`'s 41-package subtree remains reachable through
`@apollo/server`'s bundled `express@4.22.1` (and via `karma@6.4.4`, which
still appears as a non-dev parent in our `admin-ui` lockfile resolution).
The supply-chain win is **deferred** to:

1. **Apollo Server upgrade** — once `@apollo/server` is bumped past its
   Express 4 internal pin (Apollo Server v5+ already supports this), the
   transitive pull of `body-parser@1.20.x` disappears.
2. **Admin-UI retirement (karma)** — when the Angular admin-ui is fully
   retired in favour of the React dashboard.

This change still has standalone value:
- We no longer declare a dependency our code doesn't import.
- We're no longer pinning a body-parser version (`^1.20.2`) we don't
  control downstream.
- The JSDoc is now factually accurate about the current stack.
- The new documented pattern (`import { json } from 'express'`) is the
  modern Express 5 idiom and doesn't require users to declare any extra
  dependency.

**User-facing note.** Users who copied the old `import { json } from
'body-parser'` snippet into their own configs will continue to work
*today* because body-parser is still hoisted at top-level via the
transitive parents above. Once those parents drop body-parser (deferred
wins), a clean install will fail with `Cannot find module 'body-parser'`
for those users. Recovery is a one-line swap to `import { json } from
'express'` (identical behaviour) or `bun add body-parser` (preserves
the old pattern).

**Audit lesson recorded.** Per-direct-dep subtree counts (as reported by
`snapshot.mjs`) overstate removal savings when subtrees overlap with
those of other declared parents. The honest savings only show up in the
union (`transitiveTotal`) when the *last* declared parent of a subtree
is removed. Worth considering a future enhancement to the snapshot
script: an "additive transitive" column that reports packages reachable
*only* via a given direct dep.

## Stage 3 — Drop node-fetch + form-data direct deps (native fetch/FormData)

- **Commit:** `324cc22f3` on `chore/dependency-audit`
- **Date:** 2026-05-21T09:02:58.355Z
- **Total unique production packages:** 1807

### Per-Vendure-package transitive footprint

| Package | Direct deps | Unique transitive (prod) |
|---------|-------------|--------------------------|
| `@vendure/core` | 40 | 453 |
| `@vendure/common` | 0 | 0 |
| `@vendure/email-plugin` | 7 | 216 |
| `@vendure/asset-server-plugin` | 3 | 20 |
| `@vendure/admin-ui-plugin` | 3 | 71 |
| `@vendure/telemetry-plugin` | 9 | 162 |
| `@vendure/harden-plugin` | 2 | 153 |
| `@vendure/job-queue-plugin` | 2 | 23 |
| `@vendure/graphiql-plugin` | 1 | 65 |
| `@vendure/testing` | 6 | 7 |
| `@vendure/cli` | 11 | 92 |
| `@vendure/create` | 11 | 46 |
| `@vendure/dashboard` | 67 | 838 |
| `@vendure/ui-devkit` | 11 | 810 |
| `@vendure/admin-ui` | 48 | 115 |

<details>
<summary>Per-direct-dep transitive counts (click to expand)</summary>

#### `@vendure/core`

| Direct dep | Transitive count |
|-----------|------------------|
| `@nestjs/terminus` | 295 |
| `@nestjs/typeorm` | 260 |
| `@nestjs/apollo` | 237 |
| `typeorm` | 186 |
| `@apollo/server` | 151 |
| `@nestjs/graphql` | 149 |
| `@nestjs/core` | 102 |
| `@nestjs/platform-express` | 102 |
| `express` | 65 |
| `graphql-upload` | 32 |
| `http-proxy-middleware` | 19 |
| `@nestjs/common` | 18 |
| `@graphql-tools/stitch` | 17 |
| `ioredis` | 11 |
| `cookie-session` | 9 |
| `i18next-icu` | 9 |
| `intl-messageformat` | 8 |
| `fs-extra` | 4 |
| `bcrypt` | 3 |
| `graphql-scalars` | 3 |
| `graphql-tag` | 3 |
| `i18next` | 3 |
| `mime-types` | 2 |
| `rxjs` | 2 |
| `@vendure/common` | 1 |
| `cron-time-generator` | 1 |
| `croner` | 1 |
| `cronstrue` | 1 |
| `csv-parse` | 1 |
| `graphql` | 1 |
| `graphql-fields` | 1 |
| `i18next-fs-backend` | 1 |
| `i18next-http-middleware` | 1 |
| `image-size` | 1 |
| `ms` | 1 |
| `nanoid` | 1 |
| `picocolors` | 1 |
| `progress` | 1 |
| `reflect-metadata` | 1 |
| `semver` | 1 |

#### `@vendure/email-plugin`

| Direct dep | Transitive count |
|-----------|------------------|
| `mjml` | 140 |
| `express` | 65 |
| `handlebars` | 6 |
| `fs-extra` | 4 |
| `@types/nodemailer` | 3 |
| `dateformat` | 1 |
| `nodemailer` | 1 |

#### `@vendure/asset-server-plugin`

| Direct dep | Transitive count |
|-----------|------------------|
| `file-type` | 10 |
| `sharp` | 6 |
| `fs-extra` | 4 |

#### `@vendure/admin-ui-plugin`

| Direct dep | Transitive count |
|-----------|------------------|
| `express-rate-limit` | 66 |
| `fs-extra` | 4 |
| `date-fns` | 1 |

#### `@vendure/telemetry-plugin`

| Direct dep | Transitive count |
|-----------|------------------|
| `@opentelemetry/auto-instrumentations-node` | 161 |
| `@opentelemetry/sdk-node` | 78 |
| `@opentelemetry/exporter-logs-otlp-proto` | 25 |
| `@opentelemetry/exporter-trace-otlp-http` | 25 |
| `@opentelemetry/sdk-logs` | 6 |
| `@opentelemetry/resources` | 4 |
| `@opentelemetry/context-async-hooks` | 2 |
| `@opentelemetry/api` | 1 |
| `javascript-stringify` | 1 |

#### `@vendure/harden-plugin`

| Direct dep | Transitive count |
|-----------|------------------|
| `@apollo/server` | 151 |
| `graphql-query-complexity` | 3 |

#### `@vendure/job-queue-plugin`

| Direct dep | Transitive count |
|-----------|------------------|
| `bullmq` | 23 |
| `ioredis` | 11 |

#### `@vendure/graphiql-plugin`

| Direct dep | Transitive count |
|-----------|------------------|
| `express` | 65 |

#### `@vendure/testing`

| Direct dep | Transitive count |
|-----------|------------------|
| `graphql-tag` | 3 |
| `@graphql-typed-document-node/core` | 2 |
| `@vendure/common` | 1 |
| `faker` | 1 |
| `graphql` | 1 |
| `sql.js` | 1 |

#### `@vendure/cli`

| Direct dep | Transitive count |
|-----------|------------------|
| `ts-node` | 35 |
| `ts-morph` | 26 |
| `change-case` | 16 |
| `@clack/prompts` | 4 |
| `fs-extra` | 4 |
| `tsconfig-paths` | 4 |
| `@vendure/common` | 1 |
| `commander` | 1 |
| `dotenv` | 1 |
| `picocolors` | 1 |
| `strip-json-comments` | 1 |

#### `@vendure/create`

| Direct dep | Transitive count |
|-----------|------------------|
| `open` | 10 |
| `tcp-port-used` | 7 |
| `cross-spawn` | 6 |
| `handlebars` | 6 |
| `tar` | 6 |
| `@clack/prompts` | 4 |
| `fs-extra` | 4 |
| `@vendure/common` | 1 |
| `commander` | 1 |
| `picocolors` | 1 |
| `semver` | 1 |

#### `@vendure/dashboard`

| Direct dep | Transitive count |
|-----------|------------------|
| `@vendure-io/ui` | 424 |
| `@vendure-io/design-tokens` | 325 |
| `@lingui/vite-plugin` | 281 |
| `@tanstack/router-plugin` | 261 |
| `@lingui/cli` | 191 |
| `@vitejs/plugin-react` | 175 |
| `@tailwindcss/vite` | 141 |
| `vite` | 132 |
| `@tanstack/eslint-plugin-query` | 113 |
| `@lingui/react` | 87 |
| `@lingui/babel-plugin-lingui-macro` | 85 |
| `@lingui/core` | 85 |
| `express-rate-limit` | 66 |
| `@tiptap/starter-kit` | 60 |
| `@babel/preset-typescript` | 51 |
| `@tiptap/react` | 51 |
| `@babel/preset-react` | 47 |
| `recharts` | 44 |
| `@tiptap/extension-floating-menu` | 40 |
| `@babel/core` | 39 |
| `@tiptap/extension-placeholder` | 38 |
| `@tiptap/extension-image` | 37 |
| `@tiptap/extension-table` | 37 |
| `@tiptap/extension-text-style` | 37 |
| `@tiptap/pm` | 35 |
| `vaul` | 33 |
| `@tanstack/router-devtools` | 21 |
| `fast-glob` | 18 |
| `@tanstack/react-router` | 15 |
| `react-dropzone` | 10 |
| `@dnd-kit/modifiers` | 8 |
| `@dnd-kit/sortable` | 8 |
| `motion` | 8 |
| `@dnd-kit/core` | 7 |
| `gql.tada` | 7 |
| `react-day-picker` | 6 |
| `@tanstack/react-query-devtools` | 5 |
| `@tanstack/react-table` | 5 |
| `@hookform/resolvers` | 4 |
| `@uidotdev/usehooks` | 4 |
| `fs-extra` | 4 |
| `input-otp` | 4 |
| `json-edit-react` | 4 |
| `next-themes` | 4 |
| `sonner` | 4 |
| `tsconfig-paths` | 4 |
| `@tanstack/react-query` | 3 |
| `@types/react-dom` | 3 |
| `react-dom` | 3 |
| `@types/react` | 2 |
| `acorn-walk` | 2 |
| `lucide-react` | 2 |
| `react-hook-form` | 2 |
| `@fontsource-variable/geist-mono` | 1 |
| `@fontsource-variable/inter` | 1 |
| `@fontsource-variable/public-sans` | 1 |
| `acorn` | 1 |
| `awesome-graphql-client` | 1 |
| `clsx` | 1 |
| `date-fns` | 1 |
| `graphql` | 1 |
| `react` | 1 |
| `strip-json-comments` | 1 |
| `tailwind-merge` | 1 |
| `tailwindcss` | 1 |
| `tw-animate-css` | 1 |
| `zod` | 1 |

#### `@vendure/ui-devkit`

| Direct dep | Transitive count |
|-----------|------------------|
| `@angular-devkit/build-angular` | 705 |
| `@angular/cli` | 221 |
| `@angular/compiler-cli` | 62 |
| `chokidar` | 15 |
| `glob` | 8 |
| `chalk` | 6 |
| `fs-extra` | 4 |
| `@angular/compiler` | 2 |
| `rxjs` | 2 |
| `@vendure/admin-ui` | 1 |
| `@vendure/common` | 1 |

#### `@vendure/admin-ui`

| Direct dep | Transitive count |
|-----------|------------------|
| `apollo-angular` | 36 |
| `apollo-upload-client` | 35 |
| `@apollo/client` | 32 |
| `@clr/angular` | 20 |
| `ngx-translate-messageformat-compiler` | 16 |
| `@clr/core` | 14 |
| `@clr/ui` | 12 |
| `@cds/core` | 11 |
| `prosemirror-menu` | 10 |
| `@angular/platform-browser-dynamic` | 9 |
| `@ng-select/ng-select` | 9 |
| `@angular/cdk` | 8 |
| `@angular/forms` | 8 |
| `@angular/router` | 8 |
| `@messageformat/core` | 8 |
| `prosemirror-gapcursor` | 8 |
| `prosemirror-tables` | 8 |
| `@angular/platform-browser` | 7 |
| `prosemirror-history` | 7 |
| `prosemirror-keymap` | 7 |
| `@angular/animations` | 6 |
| `@ngx-translate/core` | 6 |
| `@ngx-translate/http-loader` | 6 |
| `ngx-pagination` | 6 |
| `prosemirror-commands` | 6 |
| `prosemirror-dropcursor` | 6 |
| `prosemirror-inputrules` | 6 |
| `prosemirror-schema-list` | 6 |
| `@angular/common` | 5 |
| `messageformat` | 5 |
| `prosemirror-state` | 5 |
| `@angular/core` | 4 |
| `prosemirror-schema-basic` | 3 |
| `react-dom` | 3 |
| `@biesbjerg/ngx-translate-extract-marker` | 2 |
| `@clr/icons` | 2 |
| `rxjs` | 2 |
| `@angular/language-service` | 1 |
| `@vendure/common` | 1 |
| `@webcomponents/custom-elements` | 1 |
| `chartist` | 1 |
| `codejar` | 1 |
| `dayjs` | 1 |
| `graphql` | 1 |
| `just-extend` | 1 |
| `react` | 1 |
| `tslib` | 1 |
| `zone.js` | 1 |

</details>

### Changes

Removed `node-fetch@^2.7.0` and `form-data@^4.0.0` from the workspace.
Three call-sites were rewritten to use Node's built-in `fetch`, `FormData`,
`Blob`, and `AbortSignal.timeout` (all available on the supported engine
range `^20.19.0 || >=22.12.0`):

| File | Before | After |
|------|--------|-------|
| `packages/core/src/health-check/http-health-check-strategy.ts` | `import fetch from 'node-fetch'`; `fetch(url, { timeout })` | native `fetch`; `fetch(url, { signal: AbortSignal.timeout(timeout) })` when a timeout is supplied |
| `packages/testing/src/simple-graphql-client.ts` | `node-fetch` (with named `RequestInit`/`Response` imports) + `form-data` for multipart upload | native `fetch`/`FormData`/`Blob`; a minimal inline extension to MIME table preserves per-part `Content-Type` for common test fixtures (images, pdf, txt, json) — the same behaviour `form-data` previously got from `mime-types` |
| `packages/asset-server-plugin/e2e/asset-server-plugin.e2e-spec.ts` | `node-fetch` + `res.buffer()` | native `fetch` + `Buffer.from(await res.arrayBuffer())` |

Package-level changes:

- `packages/testing/package.json`: dropped `node-fetch`, `form-data`,
  `@types/node-fetch`.
- `packages/asset-server-plugin/package.json`: dropped `node-fetch`,
  `@types/node-fetch` (both `devDependencies`).
- `packages/core`: no `package.json` change — the `node-fetch` import in
  `http-health-check-strategy.ts` was never declared in `dependencies`. It
  had been working purely via Bun's flat-hoisted `node_modules` resolving a
  sibling-workspace copy. The native-fetch rewrite incidentally fixes that
  latent declaration bug.

### Impact

- **Workspace direct declarations** of `node-fetch` / `form-data` /
  `@types/node-fetch`: **0** (down from 3 / 1 / 2 respectively).
- **`@vendure/testing` published footprint**: direct deps **8 → 6**, unique
  transitive **34 → 7**. Downstream users installing just
  `@vendure/testing` no longer pull either subtree.
- **Repo-wide unique production package count**: **1807 (unchanged)** —
  same subtree-overlap effect observed in Stage 2:
  - `node-fetch@2.x` is still anchored by `@apollo/server@4`,
    `cross-fetch`, `fbjs` (via mjml), `gaxios`, `web-resource-inliner`.
  - `form-data@4.x` is still anchored by `axios` (mjml subtree) and by
    `@types/node-fetch` — which is itself only present because
    `@apollo/server@4` declares it.

So the bulk transitive collapse for both packages is gated on the same
Apollo Server v5 upgrade noted in the [#4761 Apollo v5
comment](https://github.com/vendurehq/vendure/issues/4761#issuecomment-4506325570).
Once `@apollo/server@5` lands (which itself is gated on
`@nestjs/apollo@14`), `@types/node-fetch`, `node-fetch@2.x`, and a chunk of
the `form-data` subtree all drop in one cascade alongside `body-parser`.

The correctness win is independent and unconditional: our published
packages no longer declare `node-fetch` or `form-data` at all, and the
undeclared-dep latent bug in `@vendure/core`'s deprecated health-check is
fixed at the same time.

## Stage final — after #4762-#4771 landed on minor

- **Commit:** `c18f46f28` on `minor`
- **Date:** 2026-05-22T14:51:59.031Z
- **Total unique production packages:** 1735

### Per-Vendure-package transitive footprint

| Package | Direct deps | Unique transitive (prod) |
|---------|-------------|--------------------------|
| `@vendure/core` | 37 | 432 |
| `@vendure/common` | 0 | 0 |
| `@vendure/email-plugin` | 7 | 216 |
| `@vendure/asset-server-plugin` | 3 | 20 |
| `@vendure/admin-ui-plugin` | 3 | 71 |
| `@vendure/telemetry-plugin` | 16 | 100 |
| `@vendure/harden-plugin` | 2 | 153 |
| `@vendure/job-queue-plugin` | 2 | 23 |
| `@vendure/graphiql-plugin` | 1 | 65 |
| `@vendure/testing` | 7 | 9 |
| `@vendure/cli` | 11 | 83 |
| `@vendure/create` | 10 | 39 |
| `@vendure/dashboard` | 67 | 838 |
| `@vendure/ui-devkit` | 11 | 810 |
| `@vendure/admin-ui` | 48 | 115 |

<details>
<summary>Per-direct-dep transitive counts (click to expand)</summary>

#### `@vendure/core`

| Direct dep | Transitive count |
|-----------|------------------|
| `@nestjs/typeorm` | 260 |
| `@nestjs/apollo` | 237 |
| `typeorm` | 186 |
| `@apollo/server` | 151 |
| `@nestjs/graphql` | 149 |
| `@nestjs/core` | 102 |
| `@nestjs/platform-express` | 102 |
| `express` | 65 |
| `graphql-upload` | 32 |
| `http-proxy-middleware` | 19 |
| `@nestjs/common` | 18 |
| `@graphql-tools/stitch` | 17 |
| `ioredis` | 11 |
| `cookie-session` | 9 |
| `i18next-icu` | 9 |
| `intl-messageformat` | 8 |
| `fs-extra` | 4 |
| `bcrypt` | 3 |
| `graphql-scalars` | 3 |
| `graphql-tag` | 3 |
| `i18next` | 3 |
| `mime-types` | 2 |
| `rxjs` | 2 |
| `@vendure/common` | 1 |
| `cron-time-generator` | 1 |
| `croner` | 1 |
| `cronstrue` | 1 |
| `csv-parse` | 1 |
| `graphql` | 1 |
| `i18next-fs-backend` | 1 |
| `i18next-http-middleware` | 1 |
| `image-size` | 1 |
| `ms` | 1 |
| `nanoid` | 1 |
| `picocolors` | 1 |
| `reflect-metadata` | 1 |
| `semver` | 1 |

#### `@vendure/email-plugin`

| Direct dep | Transitive count |
|-----------|------------------|
| `mjml` | 140 |
| `express` | 65 |
| `handlebars` | 6 |
| `fs-extra` | 4 |
| `@types/nodemailer` | 3 |
| `dateformat` | 1 |
| `nodemailer` | 1 |

#### `@vendure/asset-server-plugin`

| Direct dep | Transitive count |
|-----------|------------------|
| `file-type` | 10 |
| `sharp` | 6 |
| `fs-extra` | 4 |

#### `@vendure/admin-ui-plugin`

| Direct dep | Transitive count |
|-----------|------------------|
| `express-rate-limit` | 66 |
| `fs-extra` | 4 |
| `date-fns` | 1 |

#### `@vendure/telemetry-plugin`

| Direct dep | Transitive count |
|-----------|------------------|
| `@opentelemetry/sdk-node` | 78 |
| `@opentelemetry/instrumentation-pg` | 35 |
| `@opentelemetry/exporter-logs-otlp-proto` | 25 |
| `@opentelemetry/exporter-trace-otlp-http` | 25 |
| `@opentelemetry/instrumentation-http` | 23 |
| `@opentelemetry/instrumentation-mysql2` | 23 |
| `@opentelemetry/instrumentation-express` | 22 |
| `@opentelemetry/instrumentation-ioredis` | 22 |
| `@opentelemetry/instrumentation-nestjs-core` | 21 |
| `@opentelemetry/instrumentation-graphql` | 20 |
| `@opentelemetry/instrumentation-runtime-node` | 14 |
| `@opentelemetry/sdk-logs` | 6 |
| `@opentelemetry/resources` | 4 |
| `@opentelemetry/context-async-hooks` | 2 |
| `@opentelemetry/api` | 1 |
| `javascript-stringify` | 1 |

#### `@vendure/harden-plugin`

| Direct dep | Transitive count |
|-----------|------------------|
| `@apollo/server` | 151 |
| `graphql-query-complexity` | 3 |

#### `@vendure/job-queue-plugin`

| Direct dep | Transitive count |
|-----------|------------------|
| `bullmq` | 23 |
| `ioredis` | 11 |

#### `@vendure/graphiql-plugin`

| Direct dep | Transitive count |
|-----------|------------------|
| `express` | 65 |

#### `@vendure/testing`

| Direct dep | Transitive count |
|-----------|------------------|
| `graphql-tag` | 3 |
| `@graphql-typed-document-node/core` | 2 |
| `mime-types` | 2 |
| `@vendure/common` | 1 |
| `faker` | 1 |
| `graphql` | 1 |
| `sql.js` | 1 |

#### `@vendure/cli`

| Direct dep | Transitive count |
|-----------|------------------|
| `ts-node` | 35 |
| `ts-morph` | 26 |
| `cross-spawn` | 6 |
| `@clack/prompts` | 4 |
| `fs-extra` | 4 |
| `tsconfig-paths` | 4 |
| `@vendure/common` | 1 |
| `commander` | 1 |
| `dotenv` | 1 |
| `picocolors` | 1 |
| `strip-json-comments` | 1 |

#### `@vendure/create`

| Direct dep | Transitive count |
|-----------|------------------|
| `open` | 10 |
| `cross-spawn` | 6 |
| `handlebars` | 6 |
| `tar` | 6 |
| `@clack/prompts` | 4 |
| `fs-extra` | 4 |
| `@vendure/common` | 1 |
| `commander` | 1 |
| `picocolors` | 1 |
| `semver` | 1 |

#### `@vendure/dashboard`

| Direct dep | Transitive count |
|-----------|------------------|
| `@vendure-io/ui` | 424 |
| `@vendure-io/design-tokens` | 325 |
| `@lingui/vite-plugin` | 281 |
| `@tanstack/router-plugin` | 261 |
| `@lingui/cli` | 191 |
| `@vitejs/plugin-react` | 175 |
| `@tailwindcss/vite` | 141 |
| `vite` | 132 |
| `@tanstack/eslint-plugin-query` | 113 |
| `@lingui/react` | 87 |
| `@lingui/babel-plugin-lingui-macro` | 85 |
| `@lingui/core` | 85 |
| `express-rate-limit` | 66 |
| `@tiptap/starter-kit` | 60 |
| `@babel/preset-typescript` | 51 |
| `@tiptap/react` | 51 |
| `@babel/preset-react` | 47 |
| `recharts` | 44 |
| `@tiptap/extension-floating-menu` | 40 |
| `@babel/core` | 39 |
| `@tiptap/extension-placeholder` | 38 |
| `@tiptap/extension-image` | 37 |
| `@tiptap/extension-table` | 37 |
| `@tiptap/extension-text-style` | 37 |
| `@tiptap/pm` | 35 |
| `vaul` | 33 |
| `@tanstack/router-devtools` | 21 |
| `fast-glob` | 18 |
| `@tanstack/react-router` | 15 |
| `react-dropzone` | 10 |
| `@dnd-kit/modifiers` | 8 |
| `@dnd-kit/sortable` | 8 |
| `motion` | 8 |
| `@dnd-kit/core` | 7 |
| `gql.tada` | 7 |
| `react-day-picker` | 6 |
| `@tanstack/react-query-devtools` | 5 |
| `@tanstack/react-table` | 5 |
| `@hookform/resolvers` | 4 |
| `@uidotdev/usehooks` | 4 |
| `fs-extra` | 4 |
| `input-otp` | 4 |
| `json-edit-react` | 4 |
| `next-themes` | 4 |
| `sonner` | 4 |
| `tsconfig-paths` | 4 |
| `@tanstack/react-query` | 3 |
| `@types/react-dom` | 3 |
| `react-dom` | 3 |
| `@types/react` | 2 |
| `acorn-walk` | 2 |
| `lucide-react` | 2 |
| `react-hook-form` | 2 |
| `@fontsource-variable/geist-mono` | 1 |
| `@fontsource-variable/inter` | 1 |
| `@fontsource-variable/public-sans` | 1 |
| `acorn` | 1 |
| `awesome-graphql-client` | 1 |
| `clsx` | 1 |
| `date-fns` | 1 |
| `graphql` | 1 |
| `react` | 1 |
| `strip-json-comments` | 1 |
| `tailwind-merge` | 1 |
| `tailwindcss` | 1 |
| `tw-animate-css` | 1 |
| `zod` | 1 |

#### `@vendure/ui-devkit`

| Direct dep | Transitive count |
|-----------|------------------|
| `@angular-devkit/build-angular` | 705 |
| `@angular/cli` | 221 |
| `@angular/compiler-cli` | 62 |
| `chokidar` | 15 |
| `glob` | 8 |
| `chalk` | 6 |
| `fs-extra` | 4 |
| `@angular/compiler` | 2 |
| `rxjs` | 2 |
| `@vendure/admin-ui` | 1 |
| `@vendure/common` | 1 |

#### `@vendure/admin-ui`

| Direct dep | Transitive count |
|-----------|------------------|
| `apollo-angular` | 36 |
| `apollo-upload-client` | 35 |
| `@apollo/client` | 32 |
| `@clr/angular` | 20 |
| `ngx-translate-messageformat-compiler` | 16 |
| `@clr/core` | 14 |
| `@clr/ui` | 12 |
| `@cds/core` | 11 |
| `prosemirror-menu` | 10 |
| `@angular/platform-browser-dynamic` | 9 |
| `@ng-select/ng-select` | 9 |
| `@angular/cdk` | 8 |
| `@angular/forms` | 8 |
| `@angular/router` | 8 |
| `@messageformat/core` | 8 |
| `prosemirror-gapcursor` | 8 |
| `prosemirror-tables` | 8 |
| `@angular/platform-browser` | 7 |
| `prosemirror-history` | 7 |
| `prosemirror-keymap` | 7 |
| `@angular/animations` | 6 |
| `@ngx-translate/core` | 6 |
| `@ngx-translate/http-loader` | 6 |
| `ngx-pagination` | 6 |
| `prosemirror-commands` | 6 |
| `prosemirror-dropcursor` | 6 |
| `prosemirror-inputrules` | 6 |
| `prosemirror-schema-list` | 6 |
| `@angular/common` | 5 |
| `messageformat` | 5 |
| `prosemirror-state` | 5 |
| `@angular/core` | 4 |
| `prosemirror-schema-basic` | 3 |
| `react-dom` | 3 |
| `@biesbjerg/ngx-translate-extract-marker` | 2 |
| `@clr/icons` | 2 |
| `rxjs` | 2 |
| `@angular/language-service` | 1 |
| `@vendure/common` | 1 |
| `@webcomponents/custom-elements` | 1 |
| `chartist` | 1 |
| `codejar` | 1 |
| `dayjs` | 1 |
| `graphql` | 1 |
| `just-extend` | 1 |
| `react` | 1 |
| `tslib` | 1 |
| `zone.js` | 1 |

</details>

### Changes

This is the closing snapshot of the supply-chain audit. The seven PRs that
landed on `minor` between Stage 3 and here:

| PR | Scope |
|----|-------|
| [#4762](https://github.com/vendurehq/vendure/pull/4762) | Stages 1–3 bundled: `body-parser` removal, `@types/nodemailer` recategorisation, `node-fetch` + `form-data` → native, `cross-spawn` formalised as a direct dep of `@vendure/cli` |
| [#4764](https://github.com/vendurehq/vendure/pull/4764) | `@vendure/telemetry-plugin`: replaced `@opentelemetry/auto-instrumentations-node` with eight explicit instrumentations (`http`, `express`, `nestjs-core`, `graphql`, `pg`, `mysql2`, `ioredis`, `runtime-node`). Exposed `getDefaultInstrumentations()` so callers can extend the curated set without re-declaring it |
| [#4767](https://github.com/vendurehq/vendure/pull/4767) | `@vendure/cli`: vendored `camelCase` / `pascalCase` / `kebabCase` / `constantCase` from `change-case@4.x`, dropped the dep |
| [#4768](https://github.com/vendurehq/vendure/pull/4768) | `@vendure/create`: replaced `tcp-port-used` with a native `net.Socket` implementation. Added an explicit 2s socket timeout so a DROP-firewalled host can't stall `findAvailablePort` for the OS-level connect timeout × `PORT_SCAN_RANGE` |
| [#4769](https://github.com/vendurehq/vendure/pull/4769) | `@vendure/core`: vendored `graphqlFields()` (~70 LOC covering fragments, fragment spreads, `@skip`/`@include` with variables, field merging), dropped the `graphql-fields` dep |
| [#4770](https://github.com/vendurehq/vendure/pull/4770) | `@vendure/core`: vendored a focused `ProgressBar` helper for the importer (silent in non-TTY environments, capped to `stream.columns`), dropped the `progress` dep |
| [#4771](https://github.com/vendurehq/vendure/pull/4771) | `@vendure/core`: dropped `@nestjs/terminus`. Vendored `HealthCheckError`, `HealthIndicator`, `HealthIndicatorFunction`, `HealthIndicatorResult` as a compat shim. Replaced `TypeOrmHealthIndicator` with a direct `SELECT 1` against the raw `DataSource` |

Closed without merging: [#4766](https://github.com/vendurehq/vendure/pull/4766) (`mjml` optional peer). Deferred.

### Results

Total unique production packages across the repo: **1,807 → 1,735 (−72)**.

Combined with Stages 0–3 (1,880 → 1,807, −73), the audit removed **145 unique production packages** end-to-end — matching the ≈145 figure quoted in the issue baseline.

Per-Vendure-package transitive footprint (Stage 0 baseline → final):

| Package | Direct deps | Δ direct | Transitive | Δ transitive |
|---------|------------:|---------:|-----------:|-------------:|
| `@vendure/core` | 41 → 37 | **−4** | 453 → 432 | **−21** |
| `@vendure/email-plugin` | 7 → 7 | 0 | 290 → 216 | **−74** |
| `@vendure/telemetry-plugin` | 9 → 16 | +7 (curated explicit) | 162 → 100 | **−62** |
| `@vendure/testing` | 8 → 7 | **−1** | 34 → 9 | **−25** |
| `@vendure/cli` | 11 → 11 | 0 | 92 → 83 | **−9** |
| `@vendure/create` | 11 → 10 | **−1** | 46 → 39 | **−7** |

Notes:

- `@vendure/telemetry-plugin` gained 7 direct deps (one per curated instrumentation) but shed 62 transitives — the trade is intentional: explicit declarations a maintainer can audit at a glance, in exchange for losing the Mongo / Kafka / Hapi / Cassandra / etc. subtrees that `auto-instrumentations-node` carried for libraries Vendure doesn't use.
- `@vendure/core` only shed 21 transitives despite removing four direct deps (`body-parser`, `@nestjs/terminus`, `graphql-fields`, `progress`). The terminus subtree (~295 packages quoted in the baseline) is mostly reachable through the rest of `@nestjs/*` and `@apollo/server` regardless — same overlap pattern documented for `body-parser` in Stage 2. The win is in *direct attack surface*, not raw transitive count.
- `@vendure/testing` is the biggest relative win: **34 → 9 unique transitives** (−74%). Plugin authors writing e2e suites pull in dramatically less now.

### Keep-decisions documented during the audit

Where the audit considered a dep and decided against removal:

- `fs-extra` — data-bearing-ish, subtree-overlap means modest saving, canonical-tier
- `cross-spawn` — security-sensitive (Windows `.cmd` shell-escape handling)
- `dateformat` — data-bearing (format-mask grammar)
- `cron-time-generator` — public API surface (`typeof CronTime` exposure to plugin authors)
- `mime-types` — data-bearing (IANA MIME registry snapshot, actively maintained upstream)
- `cookie-session`, `graphql-upload`, `http-proxy-middleware` — canonical implementations of wire/spec contracts where rolling our own carries security risk for marginal gain

The full reasoning is captured as comments on [#4761](https://github.com/vendurehq/vendure/issues/4761) so future audits don't re-litigate.
