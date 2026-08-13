# Channel-scoped roles — manual test guide

Covers the feature behind `authOptions.channelScopedRoles` (OSS-300 / issue #3095, superseding draft PR #3222).

## What is being proven

Issue #3095 asks for this, in its own words: *"assign **admin** permissions to a user for Channel X and only
**support** permissions for the same user on Channel Y"* without duplicating roles per channel.

PR #3222 framed it as sharing one role:

```
UserA ═══➤ CatalogManager ═══➤ ChannelA
UserB ═══➤ CatalogManager ═══➤ ChannelB      (same role, no cross-channel access)
```

Both shapes must work, and neither may leak permissions into a channel that was not granted.

## Setup

```bash
# 1. enable the feature (already set in dev-config.ts on this branch)
#    authOptions: { channelScopedRoles: true }

# 2. postgres is assumed (.env has DB=postgres); synchronize:true creates the `channel_role` table
cd packages/dev-server && bun run populate

# 3. start server + dashboard + watchers
bun run dev
```

`bun run dev` prints the URLs it assigned, e.g. `https://vendure.localhost` (API) and
`https://dashboard.vendure.localhost/dashboard/`. **Use those hostnames, not the raw
`127.0.0.1:<port>` ones** — in Portless mode the dashboard derives the API origin from the page it was
loaded from, so hitting the raw Vite port gives "api unreachable".

Two example plugins are registered in `dev-config.ts` and exercised below:

- `ChannelRoleConsumerPlugin` — consumes the unchanged authorization APIs (`@Allow`,
  `ctx.userHasPermissions()`, `RequestContextService.create()`, `SessionService.serializeSession()`,
  `RoleChangeEvent`).
- `ChannelRoleExtenderPlugin` — extends the API: a custom `PermissionDefinition`, a gated query, and a
  field resolver on `Administrator` sitting next to the new `channelRoles` field.

## Scenario A — one shared role, two isolated admins (PR #3222)

1. Create channels `channel-a` and `channel-b`.
2. Create **one** role `catalog-manager` with `[ReadCatalog, UpdateCatalog]`, assigned to both channels.
3. Create `admin-a@test.com` with `roleIds: []` and `channelRoles: [{ roleId: <catalog-manager>, channelIds: [<channel-a>] }]`.
4. Same for `admin-b@test.com`, but `channelIds: [<channel-b>]`.

Expected:

| Check | Result |
|---|---|
| `me` as admin-a | `channels` contains **only** `channel-a` |
| `me` as admin-b | `channels` contains **only** `channel-b` |
| admin-a mutates a product with `vendure-token: channel-a-token` | succeeds |
| admin-a mutates a product with `vendure-token: channel-b-token` | `FORBIDDEN` |
| admin-a on the default channel | `FORBIDDEN` |

The point: one role row, two isolated admins. Before this feature, step 2 would have granted both
channels to both admins.

## Scenario B — one user, different roles per channel (issue #3095)

1. Role `shop-admin`: `[ReadCatalog, UpdateCatalog, DeleteCatalog, CreateAdministrator, ReadAdministrator, ChannelAudit]`.
2. Role `shop-support`: `[ReadCatalog, ReadCustomer]`.
3. One admin `admin-mixed@test.com` with
   `channelRoles: [{ roleId: <shop-admin>, channelIds: [<channel-a>] }, { roleId: <shop-support>, channelIds: [<channel-b>] }]`.

Expected `me`:

```json
{ "code": "channel-a", "permissions": ["Authenticated","ReadCatalog","UpdateCatalog","DeleteCatalog","CreateAdministrator","ReadAdministrator","ChannelAudit"] }
{ "code": "channel-b", "permissions": ["Authenticated","ReadCatalog","ReadCustomer"] }
```

And, this is the requirement that matters — on `channel-b`:

- `canReadCatalog` → `true`
- `canCreateAdministrator` → **`false`** (admin permissions must not reach channel-b)
- `runChannelAudit` → **`FORBIDDEN`** (the plugin's custom permission is equally scoped)

## Scenario C — guard rails

| Attempt | Expected |
|---|---|
| Assign `catalog-manager` (only on a-and-b) via `roleIds` | `The role "catalog-manager" does not apply to every Channel, so it must be granted per Channel via channelRoles` |
| Assign SuperAdmin via `roleIds` | succeeds — it covers every channel, so it is a legitimate global role |
| An admin scoped to channel-a grants a role on channel-b | `Active user does not have sufficient permissions` |
| Remove the SuperAdmin role from the sole SuperAdmin | `Cannot remove the SuperAdmin role from the sole SuperAdmin`, whether it is held directly or via a ChannelRole |
| Send `channelRoles` while `channelScopedRoles: false` | `Channel-scoped roles require the authOptions.channelScopedRoles config option to be enabled` |

## Scenario D — plugin compatibility

Run as superadmin:

```graphql
{
  # custom permission reached the schema
  globalSettings { serverConfig { permissions { name } } }

  # core's channelRoles field and a plugin field resolver on the same type
  administrators(options: { take: 5 }) {
    items { emailAddress channelRoleSummary channelRoles { role { code } channels { code } } }
  }

  # a RequestContext built outside the request cycle resolves ChannelRoles too
  consumerSyntheticContext(userId: "<admin-a userId>") {
    identifier directRoleCodes channelRoleCodes resolvedChannels
  }

  # serializeSession() called with its original single argument
  consumerSerializeSession { hasUser channelCount }
}
```

Then as `admin-mixed@test.com` with `vendure-token: channel-a-token`:

```graphql
{
  runChannelAudit { channelCode grantedViaSession grantedViaDatabase }
}
```

`grantedViaSession` and `grantedViaDatabase` are computed by two independent code paths — the cached
session and a direct `RoleService.userHasPermissionOnChannel()` lookup. **They must agree.** A mismatch
means the merge of direct and channel-scoped permissions is inconsistent between the two.

Finally, save an administrator's roles and watch the server log for
`[ChannelRoleConsumerPlugin] RoleChangeEvent: assigned roleIds=[...]` — `RoleChangeEvent` kept its shape
(no channel dimension) and still fires for channel-scoped grants, so existing subscribers do not go
silent.

## Dashboard

On an administrator's detail page, with the option enabled, the Roles block splits in two:

- **Global roles** — the original selector, relabelled. Only accepts roles covering every channel.
- **Channel roles** — a repeatable role + channels row. `admin-mixed@test.com` should show two rows.

With the option disabled the page is unchanged, including the read-only permission preview.

## Notes / gotchas

- A field resolver on `Administrator` must not assume `administrator.user` is loaded — Vendure derives
  the joined relations from the GraphQL selection set. `channel-role-extender-plugin.ts` shows the
  fallback.
- Restart the server after editing `dev-config.ts`; the watchers only cover `core` and `common`.
- On a cold start the dashboard can die with
  `Cannot find module '@vendure/common/lib/generated-types.js'` because its Vite config loads
  `dev-config` while `rimraf lib` is still running. Re-run `bun run dev`.
