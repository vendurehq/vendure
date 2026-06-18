# @vendure/docs

This package contains the official documentation for [Vendure](https://www.vendure.io/), the open-source headless e-commerce framework.

## Overview

The `@vendure/docs` package provides:

- **Guides**: Getting started, core concepts, developer guides, and how-to tutorials
- **Reference Documentation**: TypeScript API, GraphQL API (Admin & Shop), and plugin documentation
- **User Guide**: End-user documentation for the Admin UI

## Usage

This package is designed to be consumed by the Vendure documentation platform. It exports a manifest that describes the structure and location of all documentation files.

```typescript
import { manifest } from '@vendure/docs/manifest';
```

## Structure

- `docs/` - MDX documentation files organized by category
- `dist/` - Compiled TypeScript exports
- `src/manifest.ts` - Documentation manifest defining navigation structure

## Links

- [Vendure Documentation](https://docs.vendure.io/)
- [Vendure GitHub](https://github.com/vendure-ecommerce/vendure)
- [Vendure Website](https://www.vendure.io/)

## License

This package is part of the Vendure project and is licensed under the GPL v3 license.
