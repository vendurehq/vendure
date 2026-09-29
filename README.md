<p align="center">
  <a href="https://vendure.io">
    <img alt="Vendure logo" height="60" width="auto" src="https://assets.vendure.io/brand/logo-icon-vendure-blue.svg">
  </a>
</p>

<h1 align="center">
  Vendure
</h1>
<h3 align="center">
    The open-source headless commerce platform.
</h3>
<h4 align="center">
  Plugin-first, TypeScript end to end: a Node.js, NestJS, and GraphQL backend with a React and TanStack admin dashboard.
</h4>
<h4 align="center">
  <a href="https://docs.vendure.io">Documentation</a> |
  <a href="https://vendure.io">Website</a>
</h4>

<p align="center">
  <a href="https://github.com/vendurehq/vendure/blob/master/LICENSE.md">
    <img src="https://img.shields.io/badge/license-GPLv3-blue.svg" alt="Vendure is released under the GPLv3 license." />
  </a>
  <a href="https://twitter.com/intent/follow?screen_name=vendure_io">
    <img src="https://img.shields.io/twitter/follow/vendure_io" alt="Follow @vendure_io" />
  </a>
  <a href="https://vendure.io/community">
    <img src="https://img.shields.io/badge/join-our%20discord-7289DA.svg" alt="Join our Discord" />
  </a>
  <a href="https://github.com/vendurehq/vendure/blob/master/CONTRIBUTING.md">
    <img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat" alt="PRs welcome." />
  </a>
</p>

## What is Vendure

Vendure is an open-source headless commerce platform. Model your catalog, orders, pricing, promotions, and customers on one backend you can change at the core. Run D2C, B2B, marketplace, and omnichannel on it, so teams don't choose between a rigid suite and a DIY composable stack.

- **Model your business, no forks required**: Extend or override any part of the system through stable plugin contracts and service overrides. Add custom entities, pricing logic, and workflows, and change core behaviour without patching it.
- **One backend, every channel**: A single extensible core serves any frontend through a GraphQL API, across D2C, B2B, marketplace, and omnichannel. No stitching together separate commerce services.
- **One TypeScript stack**: Node.js, NestJS, and GraphQL, with strong types across the stack and no proprietary query language. The introspectable GraphQL schema makes it straightforward to wire up LLM tool-calling, MCP servers, and agent frameworks.
- **Commerce building blocks from day one**: Catalog, orders, customers, promotions, channels, tax, shipping, payments, and stock are built in. The same extension model lets you build the workflows specific to your business on top.
- **Proven in production**: Used in production by enterprise teams and proven at high transaction volume. Stable plugin contracts give you safe extension points without forking.

## Getting started

Scaffold a new project with the server, admin dashboard, and GraphQL API ready to run:

```bash
npx @vendure/create my-shop
```

Requires Node.js (20.19+ or 22.12+) and a SQL database (PostgreSQL, MySQL, MariaDB, or SQLite). Full walkthrough and configuration options are in the [Getting Started guide](https://docs.vendure.io/guides/getting-started/installation/).

Questions? Join [our Discord](https://www.vendure.io/community) for support and discussions.

## What's in this repo

This is the Vendure source monorepo: the `@vendure/core` framework, the React and TanStack admin dashboard, the CLI, the official plugins, and an e2e testing harness. To build with Vendure, run `npx @vendure/create` (see [Getting started](#getting-started)) rather than cloning; clone this repo only to contribute to Vendure itself.

## Where it runs

Vendure runs anywhere Node.js runs: self-hosted, Docker, Kubernetes, or any cloud. You own the deployment, the data, and the stack.

If you want git-push deploys and a managed runtime, [Vendure Cloud](https://vendure.io/product/cloud) is a fully managed PaaS with a modern CLI and agent-first DevOps workflows. [Vendure Platform](https://vendure.io/product/platform) adds an optional enterprise capability layer (SSO, approval workflows, and B2B pricing) on the same open-source core.

## Contribution

Contributions are welcome: bugs, features, or docs. Our **[Contribution Guide](./CONTRIBUTING.md)** covers everything from setting up your development environment to submitting your first pull request.

Pick up a [labelled issue](https://github.com/vendurehq/vendure/issues?q=is%3Aissue%20state%3Aopen%20label%3A%22%F0%9F%91%8B%20contributions%20welcome%22) as a good first contribution.

## Security

To report a suspected security vulnerability, use
[GitHub's private vulnerability reporting](https://github.com/vendurehq/vendure/security/advisories/new).
Do not disclose security vulnerabilities through public GitHub issues or email. See our
[security policy](./SECURITY.md) for details.

## Releases

Patch releases ship regularly. Check our [release notes](https://github.com/vendurehq/vendure/releases) to keep up to date.

## License

Vendure is open source under the [GPLv3 license](./LICENSE.md). Building against the GraphQL API doesn't make your storefront or services subject to GPLv3, and a [plugin license exception](./license/plugin-exception.txt) lets you release your own Vendure plugins under any license you choose (see the [licensing FAQ](./license/license-faq.md)). Commercial licensing for Vendure Platform is on our [pricing page](https://vendure.io/pricing).

## Professional services

Need help getting your build to production? Our team offers [professional services](https://vendure.io/professional-services): architecture review, implementation support, and launch readiness from the people who build Vendure.
