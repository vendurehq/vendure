# Threat model

## What this project does and where untrusted input enters

Vendure is a headless e-commerce framework: a NestJS server with GraphQL APIs, used as a library inside a
merchant's own application. It is deployed on the public internet.

- **Shop API** (`packages/core/src/api`, resolvers under `resolvers/shop`): public and unauthenticated by default.
  Every argument, header, cookie and session token on this API is untrusted. Anonymous users can create
  sessions, build orders, register and log in.
- **Admin API** (resolvers under `resolvers/admin`): requires an authenticated administrator. Administrators
  are only partly trusted: each one is limited by role permissions and by the channels they are assigned to.
  Escaping those limits is in scope.
- **Authentication and sessions**: `packages/core/src/config/auth`, `packages/core/src/service/services/auth.service.ts`,
  `session.service.ts`, `api/middleware/auth-guard.ts`. Includes password reset, email verification and
  email-change tokens.
- **API keys**: `packages/core/src/service/services/api-key.service.ts` and
  `packages/core/src/config/api-key-strategy`. The auth guard reads the API key header on every request, so its
  value is untrusted. A bypass of the key lookup or hash check gives Admin API access.
- **List queries** (`filter`, `sort`, `options` arguments) are turned into SQL by the list query builder in
  `packages/core/src/service/helpers/list-query-builder`.
- **Asset uploads and serving**: `packages/core` (upload mutations) and `packages/asset-server-plugin`, which
  serves files and resizes images from query parameters.
- **Email plugin** (`packages/email-plugin`): templates render data that customers control (names, addresses).
- **MCP plugin** (`packages/mcp-plugin`): exposes Vendure operations to MCP clients over HTTP. `/mcp/shop` accepts
  anonymous callers by default (`shopAccess: 'anonymous'`) and offers cart and checkout tools, so its input is
  untrusted in the same way as the Shop API. `/mcp/admin` requires an OAuth bearer token, and the OAuth endpoints
  themselves (client registration, client metadata document fetches, authorization) are reachable without one.
- **Dashboard** (`packages/dashboard`): React admin app. Content that shop users or lower-privileged admins
  can write (product descriptions, customer fields, custom fields) is rendered here.

## Components that matter most / least

Most important:
- Authentication, sessions, and the permission and channel checks on the Admin API.
- Customers reaching other customers' data: orders, addresses, payments on their orders,
  account details.
- Changing what an order costs: prices, promotions, coupon codes, shipping, order state transitions,
  payments and refunds.
- SQL injection through list query options or custom field filters.
- Path traversal or remote code execution through asset upload, storage or serving.
- Stored XSS in the Dashboard from content that a customer or lower-privileged administrator can write.

Lower importance, still in scope:
- `packages/common`: shared code that ships inside core.
- `packages/mcp-sdk`: the `@McpTool` decorator and helpers that the MCP plugin uses at runtime.
- `packages/harden-plugin` (query complexity limits), `packages/job-queue-plugin`, `packages/graphiql-plugin`,
  `packages/telemetry-plugin`, `packages/sentry-plugin`.
- `packages/admin-ui` and `packages/admin-ui-plugin`: the older Angular admin app, which is being replaced
  by `packages/dashboard`.

Out of scope:
- `packages/dev-server`, `packages/testing`, `e2e-common`, `scripts`, `docs`: development and test tooling,
  never deployed.
- `packages/create`, `packages/cli` and `packages/ui-devkit`: run locally by a developer against their own project.
- Code generated into `packages/*/src/generated*` or `graphql-env.d.ts` files.

## How to exercise it

- Core e2e tests (`packages/core/e2e/*.e2e-spec.ts`) start a real server with seed data and talk to it over
  GraphQL. Run one from its package directory with `bun run e2e <spec-name>`. They use the in-memory sql.js
  driver by default and need no network or external services.
- `packages/core/e2e/administrator-update-privesc-guard.e2e-spec.ts` and the `*-channel*` / `*permission*`
  specs show how permission and channel checks are tested.
- Other plugin packages have their own `e2e` directories that run the same way.

## How you rate severity

- Critical: remote code execution; unauthenticated access to the Admin API or to any administrator account;
  SQL injection reachable from the Shop API.
- High: SQL injection reachable only from the Admin API; one customer reading or changing another customer's
  data; placing an order for less than its real price; an administrator escaping their role permissions or
  channel assignment; stored XSS in the Dashboard reachable by a customer.
- Medium: information leaks that do not expose personal or payment data; stored XSS that needs an
  administrator to write the content; denial of service from a single request that is not already stopped
  by the HardenPlugin.
- Low: anything else, including issues that need an unusual non-default configuration.

## Anything to leave alone

- Introspection being enabled, or GraphiQL being served, on its own. The schema is public in this repository,
  and GraphiQL can only do what the API already allows its caller to do. Report these only when they expose
  something beyond that, such as data or operations the caller could not otherwise reach.
- Denial of service through volume (many requests) or through very large but well-formed queries: rate
  limiting is the deployer's job, and query cost limits belong to the HardenPlugin.
- Behaviour an administrator gets because they hold `SuperAdmin` or the permission for that operation.
- Vulnerabilities in third-party dependencies that are not reachable through Vendure's code.
