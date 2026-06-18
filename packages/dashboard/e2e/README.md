# Dashboard E2E Tests

Playwright-based end-to-end tests for the Vendure dashboard.

## Running tests

```bash
# From packages/dashboard/
CI=true VITE_TEST_PORT=5176 npx playwright test --config e2e/playwright.config.ts --reporter=list

# Run a single test file
CI=true VITE_TEST_PORT=5176 npx playwright test --config e2e/playwright.config.ts e2e/tests/components/form-inputs.spec.ts --reporter=list
```

## How it works

The E2E test infrastructure has two independent servers:

1. **Vendure backend** — started in `global-setup.ts` using `@vendure/testing`.
   Runs on the port defined in `constants.ts`. Seeded with test data (products,
   customers, etc.) and configured with custom fields and test plugins.

2. **Vite dev server** — started by Playwright's `webServer` option (see
   `playwright.config.ts`). Serves the dashboard frontend. This is the server
   that Playwright navigates to in tests.

These two servers use separate configurations:

| Server | Config | Purpose |
|--------|--------|---------|
| Vendure backend | `global-setup.ts` (imports `e2e-shared-config.ts`) | Starts the Vendure server with test DB, CORS, custom fields, and server-only plugins |
| Vite dev server | `fixtures/e2e-vendure-config.ts` (via `VENDURE_CONFIG_PATH`) | Tells the Vite plugin which dashboard extensions to load |

**Important:** Custom fields belong only in `global-setup.ts` (via
`e2e-shared-config.ts`), NOT in `e2e-vendure-config.ts`. The Vite plugin
generates the dashboard's GraphQL schema from its config, and struct custom
fields there cause product creation mutations to fail. The dashboard
discovers custom fields at runtime from the backend API.

## Test file organisation

```
e2e/
├── fixtures/                        # Test data and plugins
│   ├── e2e-shared-config.ts          # Custom fields & payment handlers (backend only)
│   ├── e2e-vendure-config.ts        # Vendure config for Vite plugin discovery
│   ├── form-inputs-test-plugin.ts   # Example: E2E-only dashboard plugin
│   ├── form-inputs-test-dashboard/  # Dashboard extension for the plugin above
│   │   ├── index.tsx                # Entry point (defineDashboardExtension)
│   │   └── form-inputs-test-page.tsx
│   ├── custom-history-entry-plugin.ts
│   └── initial-data.ts
├── tests/
│   ├── auth/          # Login and authentication
│   ├── catalog/       # Products, collections, facets, assets
│   ├── components/    # Shared UI component behaviour
│   ├── customers/     # Customers and groups
│   ├── marketing/     # Promotions
│   ├── sales/         # Orders and order modification
│   ├── settings/      # Channels, roles, payment methods, etc.
│   └── system/        # Jobs, health checks, scheduled tasks
├── global-setup.ts
├── global-teardown.ts
├── playwright.config.ts
└── constants.ts
```

## Adding test pages via dashboard extensions

When E2E tests need a custom page (e.g. to test form components in isolation),
use the dashboard extension mechanism rather than placing files directly in the
`src/app/routes/` directory. This keeps test code out of the production source
tree and exercises the same extension infrastructure that real plugins use.

### Step-by-step

#### 1. Create a VendurePlugin

Create a minimal plugin in `e2e/fixtures/` that declares a `dashboard` entry
point:

```ts
// e2e/fixtures/my-test-plugin.ts
import { VendurePlugin } from '@vendure/core';

@VendurePlugin({
    dashboard: './my-test-dashboard/index.tsx',
})
export class MyTestPlugin {}
```

#### 2. Create the dashboard extension entry

The entry file calls `defineDashboardExtension` to register routes (and
optionally nav items, widgets, form components, etc.):

```tsx
// e2e/fixtures/my-test-dashboard/index.tsx
import { defineDashboardExtension } from '@vendure/dashboard';

import { MyTestPage } from './my-test-page';

defineDashboardExtension({
    routes: [
        {
            path: '/my-test-page',
            component: () => <MyTestPage />,
        },
    ],
});
```

#### 3. Write the page component

This is a plain React component — no TanStack Router file-based routing needed.
Import UI components from `@vendure/dashboard` (not internal `@/vdb/` paths):

```tsx
// e2e/fixtures/my-test-dashboard/my-test-page.tsx
import { Page, PageLayout, PageTitle, FullWidthPageBlock } from '@vendure/dashboard';

export function MyTestPage() {
    return (
        <Page pageId="my-test-page">
            <PageTitle>My Test Page</PageTitle>
            <PageLayout>
                <FullWidthPageBlock blockId="my-test-page">
                    {/* test content */}
                </FullWidthPageBlock>
            </PageLayout>
        </Page>
    );
}
```

#### 4. Register the plugin in the E2E vendure config

Add your plugin to `e2e/fixtures/e2e-vendure-config.ts`:

```ts
import { MyTestPlugin } from './my-test-plugin';

export const config: VendureConfig = {
    // ...
    plugins: [FormInputsTestPlugin, MyTestPlugin],
};
```

The Playwright config already sets `VENDURE_CONFIG_PATH` to point to this file,
so the Vite plugin will discover the new dashboard extension automatically.

#### 5. Write tests against the page

```ts
test('should do something on my test page', async ({ page }) => {
    await page.goto('/my-test-page');
    // ...
});
```

### Why not copy files into `src/app/routes/`?

- Test code would be in the production source tree (risk of shipping it)
- TanStack Router's Vite plugin would generate route entries for test pages,
  polluting `routeTree.gen.ts`
- The file-copy approach requires cleanup in `globalTeardown` and is fragile
  if the test run is interrupted

Using the extension mechanism avoids all of these issues and also validates that
the extension routing infrastructure works correctly.
