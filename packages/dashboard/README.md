# Vendure Dashboard

This is a React-based admin dashboard for Vendure. It is a standalone application that can be extended to suit the
needs of any Vendure project.

The package consists of three main components:

- `@vendure/dashboard`: Dashboard source code
- `@vendure/dashboard/vite`: A Vite plugin that is used to compile the dashboard in your project
- `@vendure/dashboard/plugin`: A Vendure plugin that provides backend functionality used by the dashboard app.

## DashboardPlugin

### Basic usage - serving the Dashboard UI

```typescript
import { DashboardPlugin } from '@vendure/dashboard-plugin';

const config: VendureConfig = {
  // Add an instance of the plugin to the plugins array
  plugins: [
    DashboardPlugin.init({ route: 'dashboard' }),
  ],
};
```

The Dashboard UI will be served at the `/dashboard/` path.

### Using only the metrics API

If you are building a stand-alone version of the Dashboard UI app and don't need this plugin to serve the Dashboard UI, you can still use the `metricSummary` query by adding the `DashboardPlugin` to the `plugins` array without calling the `init()` method:

```typescript
import { DashboardPlugin } from '@vendure/dashboard-plugin';

const config: VendureConfig = {
  plugins: [
    DashboardPlugin, // <-- no call to .init()
  ],
  // ...
};
```

### Custom Dashboard UI build

You can also provide a custom build of the Dashboard UI:

```typescript
import { DashboardPlugin } from '@vendure/dashboard-plugin';

const config: VendureConfig = {
  plugins: [
    DashboardPlugin.init({ 
      route: 'dashboard',
      app: path.join(__dirname, 'custom-dashboard-build'),
    }),
  ],
};
```

## API

### DashboardPluginOptions

- `route: string` - The route at which the Dashboard UI will be served (default: `'dashboard'`)
- `app?: string` - Optional path to a custom build of the Dashboard UI

## Development

Run `bunx vite` to start Vite in dev mode.

### Note on internal `@/vdb` imports

You will notice that the dashboard uses internal Vendure Dashboard imports prefixed with `@/vdb`. This is adapted from the
convention of Shadcn which uses a `@/*` path alias for internal imports.

**Why not just use relative imports?**

The problem with using relative imports is that they are handled differently by Vite when compiling the dashboard. This
manifests as things like React Context not working correctly. The underlying reason is that Vite will selectively
pre-compile source code and mixing the imports between alias and relative can result in 2 "versions" of the same code
being loaded, which causes issues with React Context and other things that rely on a single instance of a module.

For this reason, try to use the `@/vdb` alias for all internal Vendure Dashboard imports to the "src/lib" directory.

This is especially import for hooks (since many of them use React Context) and there is even a pre-commit hook
that will run [a script](./scripts/check-internal-imports.js) to ensure that you are not using relative imports for
internal Vendure Dashboard code.

**Type Safety for Consumers**

Because we ship source code in the npm package, consumers need to tell TypeScript how to resolve these internal
imports by adding the path alias to _their_ `tsconfig.json` file.

```json
{
    "compilerOptions": {
        "paths": {
            "@/vdb/*": [
                "./node_modules/@vendure/dashboard/src/lib/*"
            ]
        }
    }
}
```

Note: even without that path alias, the vite compilation will still work, but TypeScript types will not resolve correctly
when developing dashboard extensions.

## Testing

Run `bun run test` to run unit tests once, or `bunx vitest` to run them in watch mode.

For E2E (Playwright) tests, see [e2e/README.md](./e2e/README.md).

## Translations

See [./scripts/translate/README.md](./scripts/translate/README.md)
