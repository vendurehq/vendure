# Vendure GraphiQL Plugin

This plugin adds separate GraphiQL playgrounds for the Admin API and Shop API to your Vendure server.

## Installation

```bash
npm install @vendure/graphiql-plugin
```

or

```bash
yarn add @vendure/graphiql-plugin
```

## Usage

Add the plugin to your Vendure config:

```typescript
import { GraphiqlPlugin } from '@vendure/graphiql-plugin';
import { VendureConfig } from '@vendure/core';

export const config: VendureConfig = {
    // ... other config
    plugins: [
        GraphiqlPlugin.init({
            route: 'graphiql', // Optional, defaults to 'graphiql'
        }),
        // ... other plugins
    ],
};
```

## Features

- Separate GraphiQL playground UIs at:
    - `/graphiql/admin` - Admin API playground
    - `/graphiql/shop` - Shop API playground
- Automatic detection of API paths from your Vendure configuration
- Easy navigation between Admin and Shop APIs
- Modern, responsive UI
- Built with Vite and React

## Custom API paths

By default, the plugin automatically reads the Admin API and Shop API paths from your Vendure configuration.

If you need to override these paths, you can specify them explicitly:

```typescript
GraphiQLPlugin.init({
    route: 'my-custom-route', // defaults to `graphiql`
});
```

## Development

The plugin uses Vite to build a React application for the GraphiQL UI. The build process automatically compiles the React app and serves it from the plugin.

To develop the UI:

```bash
bun run dev
```

To build the plugin:

```bash
bun run build
```

This will:

1. Build the React application using Vite
2. Compile the TypeScript code for the plugin
3. Package everything for distribution
