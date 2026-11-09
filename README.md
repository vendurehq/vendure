<h2 align="center">The ecommerce platform for complex B2B</h2>

<p align="center">
  <a href="https://vendure.io">Website</a> ·
  <a href="https://docs.vendure.io">Documentation</a> ·
  <a href="https://vendure.io/pricing">Pricing</a> ·
  <a href="https://vendure.io/blog">Blog</a> ·
  <a href="https://vendure.io/discord">Discord</a>
</p>

<p align="center">
  <a href="https://docs.vendure.io/guides/getting-started/installation/">
    <img src="https://raw.githubusercontent.com/vendurehq/.github/main/profile/vendure-banner.png" width="1280" alt="Vendure: the ecommerce platform for complex B2B, built on GraphQL, NestJS and React" />
  </a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@vendure/core"><img src="https://img.shields.io/npm/v/@vendure/core?label=npm" alt="@vendure/core on npm" /></a>
  <a href="./LICENSE.md"><img src="https://img.shields.io/badge/license-GPLv3-blue.svg" alt="Vendure is released under the GPLv3 licence" /></a>
  <a href="https://github.com/vendurehq/vendure/stargazers"><img src="https://img.shields.io/github/stars/vendurehq/vendure" alt="GitHub stars" /></a>
  <a href="https://github.com/vendurehq/vendure/pulse"><img src="https://img.shields.io/github/commit-activity/m/vendurehq/vendure" alt="Commits per month" /></a>
  <a href="https://vendure.io/discord"><img src="https://img.shields.io/badge/join-our%20discord-7289DA.svg" alt="Join our Discord" /></a>
  <a href="./CONTRIBUTING.md"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat" alt="PRs welcome" /></a>
</p>

<br />

# Why Vendure

Vendure is a commerce backend that engineering teams can change at the core. Model the catalog, orders, pricing, promotions and customers the way your business works, and serve B2B, D2C, marketplace and omnichannel sales from one GraphQL API.

- **Model your business, no forks required**: Extend or override any part of the system through stable plugin contracts and service overrides. Add custom entities, pricing logic, and workflows, and change core behaviour without patching it.
- **One backend, every channel**: A single extensible core serves any frontend through a GraphQL API, across D2C, B2B, marketplace, and omnichannel. No stitching together separate commerce services.
- **One TypeScript stack**: Node.js, NestJS, and GraphQL, with strong types across the stack and no proprietary query language. The introspectable GraphQL schema makes it straightforward to wire up LLM tool-calling, MCP servers, and agent frameworks.
- **Commerce building blocks from day one**: Catalog, orders, customers, promotions, channels, tax, shipping, payments, and stock are built in. The same extension model lets you build the workflows specific to your business on top.
- **Proven in production**: Used in production by enterprise teams and proven at high transaction volume. Stable plugin contracts give you safe extension points without forking.

<a href="https://vendure.io/core">Learn why we built Vendure this way</a> · <a href="https://vendure.io/compare">See how Vendure compares</a> · <a href="https://vendure.io/migrate">Moving from another platform</a>

<br />

# Installation

### Quick start

Scaffold a project with the server, worker, admin dashboard and GraphQL APIs ready to run:

```bash
npx @vendure/create my-shop
```

Requires Node.js 22.12+ (20.19+ still runs, but Node.js 20 is end-of-life) and a SQL database (PostgreSQL, MySQL, MariaDB or SQLite). The [getting started guide](https://docs.vendure.io/guides/getting-started/installation/) covers configuration, seed data and your first plugin. Ask questions on [our Discord](https://vendure.io/discord).

### Self-hosting

Vendure runs anywhere Node.js runs, including Docker, Kubernetes, a single VM or any cloud provider. Self-hosting is free, and your data stays in your own database. See the [deployment guides](https://docs.vendure.io/guides/deployment/).

### Vendure Cloud

[Vendure Cloud](https://vendure.io/cloud) is the managed runtime for Vendure. It deploys on git push, creates a preview environment for every pull request, and manages the database, queues, search, backups and scaling. It runs the same application you can self-host, so you can move to Cloud without rebuilding it. Every paid plan includes Cloud at no extra cost. Cloud is in design-partner preview now, with general availability planned for Q1 2027.

<br />

# What Core includes

Plugins let you extend or replace any of the features below.

| Feature | What it covers |
|---|---|
| **[Catalog](https://docs.vendure.io/guides/core-concepts/products/)** | Products, variants, facets, collections and [custom fields](https://docs.vendure.io/guides/developer-guide/custom-fields/) on any entity |
| **[Orders](https://docs.vendure.io/guides/core-concepts/orders/)** | Carts, draft orders, modifications, fulfillment and returns |
| **[Stock](https://docs.vendure.io/guides/core-concepts/stock-control/)** | Multi-location inventory, allocation and backorders |
| **[Promotions](https://docs.vendure.io/guides/core-concepts/promotions/)** | Conditions and actions you compose, or write your own |
| **[Payments](https://docs.vendure.io/guides/core-concepts/payment/)** | Provider-agnostic payment and shipping integrations |
| **[Channels](https://docs.vendure.io/guides/core-concepts/channels/)** | Multi-channel, multi-region, multi-currency and multi-language from one instance |
| **[Plugins](https://docs.vendure.io/guides/developer-guide/plugins/)** | Extend or override any service, entity or strategy without forking the core |
| **[GraphQL APIs](https://docs.vendure.io/guides/developer-guide/extending-the-graphql-api/)** | Typed Shop and Admin APIs that you can extend. Agent frameworks and MCP servers can read the schema through introspection |
| **[Dashboard](https://docs.vendure.io/guides/extending-the-dashboard/getting-started/)** | React and TanStack admin app, extensible with your own pages and form elements |
| **[TypeScript API](https://docs.vendure.io/reference/typescript-api/)** | Typed reference docs for every service, strategy and event |

<br />

# Beyond the open-source core

Vendure has four paid plans built on top of this repository: Starter, Growth, Scale and Enterprise. They add B2B features such as company accounts, quotes, contract pricing, account hierarchies, approvals, single sign-on and audit logs. Every paid plan also includes direct support from the Vendure team, a commercial license and Vendure Cloud at no extra cost. See [plans and pricing](https://vendure.io/pricing).

# What's in this repo

This is the Vendure source monorepo: the `@vendure/core` framework, the React and TanStack admin dashboard, the CLI, the official plugins, and an e2e testing harness. To build with Vendure, run `npx @vendure/create` (see [Getting started](#installation)) rather than cloning; clone this repo only to contribute to Vendure itself.

# Contribution

Contributions are welcome: bugs, features, or docs. Our **[Contribution Guide](./CONTRIBUTING.md)** covers everything from setting up your development environment to submitting your first pull request.

Pick up a [labelled issue](https://github.com/vendurehq/vendure/issues?q=is%3Aissue%20state%3Aopen%20label%3A%22%F0%9F%91%8B%20contributions%20welcome%22) as a good first contribution.

# Security

To report a suspected security vulnerability, use
[GitHub's private vulnerability reporting](https://github.com/vendurehq/vendure/security/advisories/new).
Do not disclose security vulnerabilities through public GitHub issues or email. See our
[security policy](./SECURITY.md) for details.

# Releases

Patch releases ship regularly. Check our [release notes](https://github.com/vendurehq/vendure/releases) to keep up to date.

# License

Vendure is open source under the [GPLv3 license](./LICENSE.md). Building against the GraphQL API doesn't make your storefront or services subject to GPLv3, and a [plugin license exception](./license/plugin-exception.txt) lets you release your own Vendure plugins under any license you choose (see the [licensing FAQ](./license/license-faq.md)). Every paid plan includes a commercial license. See [pricing](https://vendure.io/pricing).

# Professional services

Need help getting your build to production? Our team offers [professional services](https://vendure.io/services): architecture review, implementation support, and launch readiness from the people who build Vendure.
