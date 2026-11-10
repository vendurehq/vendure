# OSS-1002: More granular trackInventory controls — spike report

## Summary

Inventory tracking should belong to the stock, so it should be set per StockLevel (one variant at one location), with a per-Channel default. It should not live on a per-channel variant row.
Recommended resolution order, most specific first: **StockLevel → ProductVariant → Channel**. `GlobalSettings.trackInventory` goes away. `Channel.trackInventory` already exists in the schema and API, but core never reads it. v4 should make it the default.
The more important finding is a correctness bug that exists today. Releases, sales and cancellations re-read the *current* flag instead of the one in force when the stock was allocated. If the flag changes while an order is open, units stay allocated forever, or another order's allocation gets released. Any finer-grained flag makes this worse.
The fix is to record on each stock movement whether it changed the StockLevel figures (`StockMovement.tracked`). Later movements of the same order line then follow that record.
The prototype does all of this, passes the new e2e tests, and keeps the existing core e2e suite green once five test setups are ported off the removed GlobalSettings field.
The schema changes are additive, plus one column removal. The API break is small: `GlobalSettings.trackInventory` is removed. The semantic break matters more: code that reads `ProductVariant.trackInventory` to decide whether stock is tracked can now be wrong.

## Recommendation

**Do in v4.0.** Scope:

1. Wire `Channel.trackInventory` as the default for `INHERIT`. Remove `GlobalSettings.trackInventory`, with a migration helper that copies it to every Channel.
2. Add `StockLevel.trackInventory: GlobalFlag` (default `INHERIT`) to the entity and the Admin API (`StockLevel.trackInventory`, `StockLevelInput.trackInventory`).
3. Add `StockMovement.tracked` (nullable boolean) and make Release, Sale and Cancellation follow the movement ledger, not the current flag. This should be done **even if (1) and (2) are cut**, because it fixes a bug that exists today.
4. Add an optional `StockLocationStrategy.isInventoryTracked(ctx, variant, stockLevel?)` hook and `AvailableStock.hasUntrackedStock`. Custom rules then need no core change, e.g. per vendor or per channel from custom fields.
5. Fix two master bugs found on the way (both in the prototype): Sale, Release and Cancellation rows record the whole line quantity per location, and `MultiChannelStockLocationStrategy.forAllocation` over-allocates when an order is split across locations.
6. Dashboard: global settings page, fulfil dialog, a per-location tracking select on the variant page, and a resolved "effective" value from the server.

Out of scope, but recommended as a v4 follow-up with the same mechanics: move `outOfStockThreshold` from GlobalSettings to Channel (and possibly StockLevel). It has the same dead `Channel.outOfStockThreshold` column.

## What was investigated

Data model today (master = `origin/major` at 90e1489fb):
- `ProductVariant.trackInventory: GlobalFlag` (`INHERIT` by default). `packages/core/src/entity/product-variant/product-variant.entity.ts:156-157`
- `GlobalSettings.trackInventory: boolean`, marked `@deprecated use Channel.trackInventory`, but it is the only default anything reads. `entity/global-settings/global-settings.entity.ts:26-35`
- `Channel.trackInventory: boolean` and `Channel.outOfStockThreshold`. In the schema and both APIs (`api/schema/common/channel.type.graphql:17,21`, `admin-api/channel.api.graphql:37-38,54-55`), but **never read by core**. `entity/channel/channel.entity.ts:93-108`. Michael said in #2908 that this was meant to become `global → channel → variant`.
- `StockLevel` is unique on (variant, location), and holds `stockOnHand` and `stockAllocated`. There is no tracking flag. `entity/stock-level/stock-level.entity.ts:18-45`
- `StockLocation` is `ChannelAware` (many-to-many with Channel). `StockMovement` is single-table inheritance (Allocation, Sale, Release, Cancellation, StockAdjustment, Return) with a per-row `stockLocationId`. `entity/stock-movement/stock-movement.entity.ts`

Every read of the flag (all resolve variant → GlobalSettings):
- `StockMovementService` reads `getSettings().trackInventory` in each of: allocation (`service/services/stock-movement.service.ts:214,241,271`), sale (`:312,345`), cancellation (`:391,411`) and release (`:444,464`). It uses `trackInventoryForVariant()` at `:481-486`. **Each step re-resolves the current flag.**
- `StockLevelService.filterToTrackedIds` decides which variants to lock. `service/services/stock-level.service.ts:378-392`
- `BaseStockLocationStrategy.getVariantStockSettings` (`config/catalog/default-stock-location-strategy.ts:122-140`) is used by `DefaultStockLocationStrategy.forAllocation` (`:216-256`) and `MultiChannelStockLocationStrategy.forAllocation` (`multi-channel-stock-location-strategy.ts:116-141`).
- `ProductVariantService.getSaleableStockLevel` (`service/services/product-variant.service.ts:334-357`), `getOutOfStockThreshold` (`:359-370`) and `getFulfillableStockLevel` (`:388-398`).
- Consumers of saleable stock: `OrderModifier` quantity check (`service/helpers/order-modifier/order-modifier.ts:134`), the ArrangingPayment check (`config/order/default-order-process.ts:380`), the fulfillment check (`service/services/order.service.ts:1879`), the default search index `inStock` (`plugin/default-search-plugin/indexer/indexer.controller.ts:491,508`), and the Shop `ProductVariant.stockLevel` via `StockDisplayStrategy` (`api/resolvers/entity/product-variant-entity.resolver.ts:152`). Admin `stockOnHand` and `stockAllocated` come from `getAvailableStock` (`:179,189`).
- `StockLocationStrategy` (`config/catalog/stock-location-strategy.ts:55-114`): `getAvailableStock` only gets a variant id. `forRelease`, `forSale` and `forCancellation` are derived from Allocation rows in the base class (`default-stock-location-strategy.ts:142-173`).
- `stockAllocated` is clamped at 0 on decrement (`stock-level.service.ts:278-302`). This hides the negative case, but not the case where the over-decrement eats another order's allocation.
- Dashboard: it re-implements INHERIT resolution against `globalSettings.trackInventory` client-side. `packages/dashboard/src/app/routes/_authenticated/_product-variants/utils/stock-settings.ts`, `_orders/components/fulfill-order-dialog.tsx:109,132-134`, `_global-settings/global-settings.tsx:63,143`, and the queries in `_orders/orders.graphql.ts:140` and `_global-settings/global-settings.graphql.ts:8`.
- Other packages: `mcp-plugin` exposes `ProductVariant.trackInventory` (`src/tools/built-in/admin/entity-field-schemas.ts:53`). Its stock level serializer does not expose the flag. There is no elasticsearch plugin on `major`. Core's default search plugin indexes `inStock` per channel, which now becomes channel-correct.

Bugs found on master (demonstrated by `e2e/stock-control-granular-tracking.e2e-spec.ts`, 7 of 9 failing on master):
1. Tracked at allocation, untracked at cancel: the units stay in `stockAllocated` forever.
2. Untracked at allocation, tracked at cancel: the release decrements units it never allocated. That frees another open order's allocation. The clamp hides this only when nothing else is allocated.
3. Tracked at allocation, untracked at fulfilment: the stock is never deducted and stays allocated.
4. `Channel.trackInventory = false` has no effect.
5. In a split order, each per-location Sale, Release or Cancellation row records the **line** quantity (`stock-movement.service.ts:339,405,459`).
6. `MultiChannelStockLocationStrategy.forAllocation` caps each location at `min(quantity, available)` instead of the quantity still needed (`multi-channel-stock-location-strategy.ts:141`). An order split across two locations over-allocates.

## Design options considered

| Option | Pros | Cons | Verdict |
| -- | -- | -- | -- |
| (a) Move the flag to StockLevel only (copy variant value to every row) | Matches physical stock; per-location control (#2908 ask) | Denormalised; new StockLevels lose the setting; no "whole variant" switch; a variant with no StockLevel in a channel has nowhere to say "untracked"; every reader breaks | Rejected as sole home |
| (b) Per channel on a ProductVariant–Channel join row (OSS-1001's explicit join) | Matches per-channel `enabled`; simple UI ("track in this channel") | Tracking is about stock, not about where it's sold. With a location shared by two channels, channel A decrements and channel B sells the same units without decrementing, so stock figures for A are wrong. Needs the join entity (which OSS-1001 may or may not ship). Per-location need (#2908) still unmet | Rejected |
| (c) Strategy-only: keep variant flag, let `StockLocationStrategy` decide | Non-breaking; no schema change | No data home, so every user writes custom fields; does not fix the ledger bug; dashboard can't show it | Kept as the extension hook, not as the design |
| (e) Location-only: StockLevel → StockLocation default → Variant, no channel layer | One physical source of truth; no shared-location hazard; no default-channel ambiguity | "Don't track in channel B" needs a dedicated untracked location instead of one switch; removes `Channel.trackInventory` too (second API removal); diverges from the `global → channel → variant` plan in #2908 | Considered, rejected by the maintainer (2026-11-10) in favour of (d) |
| **(d) Layered: StockLevel override → Variant → Channel default, + movement ledger + strategy hook** | Per-location and per-channel control; reuses the existing `Channel.trackInventory` column; `INHERIT` semantics carry over unchanged; additive schema; the ledger makes changes mid-order safe; strategy hook covers anything else | Removes `GlobalSettings.trackInventory`; semantics of `ProductVariant.trackInventory` narrow from "the answer" to "the variant's default"; one extra variant read per `getAvailableStock` (fixable) | **Chosen** |

Resolution when the layers disagree (`config/catalog/track-inventory.ts`):
1. `StockLevel.trackInventory` if `TRUE` or `FALSE` (most specific: this variant at this location)
2. else `ProductVariant.trackInventory` if `TRUE` or `FALSE`
3. else `Channel.trackInventory` of the request's channel (for allocation, the order's channel)

`INHERIT` keeps its meaning at each level. Without a location (variant page, `getOutOfStockThreshold`), steps 2 and 3 apply. For saleable stock, any applicable untracked StockLevel makes the variant unlimited, because allocation can always be served from it. If the variant has no StockLevel in the channel, the variant and channel decide.

Why the channel layer is still safe with shared locations: an order allocated in an untracked channel records `tracked=false` and never touches the figures. A tracked channel's figures stay internally consistent. The merchant has chosen not to count channel B's sales against that stock. Merchants who want per-location truth should use StockLevel overrides or dedicated locations. The docs must say this.

## Prototype

Branch `mbromley/oss-1002-spike-more-granular-trackinventory`. Key commits:
- `087c05d13` chore(spike): lane-local e2e ports — do not merge
- `bfab2eda4` failing e2e tests
- `8e2a1d388` prototype
- `a4f97649f` port e2e setups and sum untracked levels
- `f5b30742e` migration test (the helper is in `a4f97649f`)
- the next commit: this report

Key files:
- `packages/core/src/config/catalog/track-inventory.ts`: `resolveTrackInventory()` (new, exported)
- `packages/core/src/config/catalog/stock-location-strategy.ts`: optional `isInventoryTracked()`, `AvailableStock.hasUntrackedStock`
- `packages/core/src/config/catalog/default-stock-location-strategy.ts`: base `isInventoryTracked`, `sumStockLevels`, `getStockLevelsForAllocation` (locks only when a level is tracked), default `forAllocation` per level
- `packages/core/src/config/catalog/multi-channel-stock-location-strategy.ts`: tracking per level and the over-allocation fix
- `packages/core/src/service/services/stock-movement.service.ts`: `tracked` snapshot on Allocation, `getTrackedLedger()` driving Release, Sale and Cancellation, per-location quantities, `StockLevelInput.trackInventory`
- `packages/core/src/service/services/stock-level.service.ts`: `isInventoryTracked()`, `isInventoryTrackedAtLocation()`, lock filter
- `packages/core/src/service/services/product-variant.service.ts`: saleable and fulfillable stock via `hasUntrackedStock`, with a fallback for strategies written before v4
- Entities: `StockLevel.trackInventory`, `StockMovement.tracked`, `GlobalSettings.trackInventory` removed
- Schema: `admin-api/stock-level.type.graphql`, `product.api.graphql` (`StockLevelInput`), `global-settings.*.graphql`
- `packages/core/src/migration-utils/v4_0_track_inventory.ts`: `migrateTrackInventoryToChannels()`

Ledger rule: tracking is fixed when a unit is allocated, for that unit's whole life in the order. For each order line and location, `allocatedTracked = Σ tracked Allocations − Σ tracked Releases − Σ tracked Sales` and `soldTracked = Σ tracked Sales − Σ tracked Cancellations`. A Release or Sale moves `min(qty, allocatedTracked)`. A Cancellation restores `min(qty, soldTracked)`. A movement that is partly tracked is written as two rows. Rows from before v4 (`tracked = NULL`) count as tracked if the location is tracked now, which is today's behaviour.

## Testing done

New e2e:
- `e2e/stock-control-granular-tracking.e2e-spec.ts` (9 tests): flag flips mid-order (release both ways, fulfilment), `Channel.trackInventory` default (2 channels, MultiChannelStockLocationStrategy), StockLevel override, split order across tracked and untracked locations (allocation, cancel, fulfilment, Sale quantities). **Master: 7 failed / 2 passed** (the 2 are controls). **Prototype: 9/9 passed.**
- `e2e/migrate-track-inventory.e2e-spec.ts` (5 tests): see Migration story. **5/5 passed on sqljs and on postgres 16.**

Existing core e2e suite (135 files, sqljs):
- **Master** (`087c05d13`, master plus lane ports): 2751 passed, 0 failed, 55 skipped (2806).
- **Prototype, first run**: 2682 passed, 3 failed, 130 skipped. The 3 failures were `duplicate-entity` (1) and `import` (2) snapshots. Both came from the Admin `stockOnHand` excluding untracked levels, which I fixed: `AvailableStock` sums all levels again. Five files (`stock-control`, `stock-control-multi-location`, `global-settings`, `facet`, `product`) failed in setup hooks because their queries and fragments select the removed `GlobalSettings.trackInventory`. That blocked 69 tests. This is the direct API break. `tax-category` failed once and passed on rerun, so it is flaky and unrelated.
- **Ported**: the setups switch to `updateChannel({ id: 'T_1', trackInventory })`, the field is removed from `globalSettingsFragment`, and the `global-settings` spec drops its two trackInventory assertions.
- **Prototype, final run**: **2765 passed, 0 failed, 55 skipped (2820)**. That is the 2751 baseline plus the 14 new tests, with the same 55 skips as master. The ported `stock-control` suite (45 tests) passes, so the variant-level semantics are preserved.

Unit tests: 21 of 76 in `config/catalog/*.spec.ts`, `stock-level.service.spec.ts`, `stock-movement.service.spec.ts` and `product-variant.service.spec.ts` fail on the prototype. All fail at the mock level: the mocks lack `ctx.channel`, `variant.trackInventory` or `connection.getRepository`, and the lock-count assertions count the new variant read. They were not updated in the spike.

DBs: e2e on sqljs. Migration test on sqljs and postgres 16 (docker, lane port 15436). The granular-tracking spec also passes on postgres (9/9, with real row locks).
Not tested: MySQL/MariaDB; concurrency (`stock-level-concurrency` ran only on sqljs, where locks are no-ops); dashboard (not changed); a custom `StockLocationStrategy` from before v4 (covered by the fallback, but not tested); performance.

## Migration story

Schema (from a generated migration, i.e. `createSchemaBuilder().log()`):
- `stock_level.trackInventory varchar NOT NULL DEFAULT 'INHERIT'`
- `stock_movement.tracked boolean NULL`
- `global_settings.trackInventory` dropped

Data: `migrateTrackInventoryToChannels(queryRunner)` copies `global_settings.trackInventory` into every `channel.trackInventory`. That keeps behaviour identical, because the channel column was never read. Channels whose stored value differed are overwritten and listed in the log, so the merchant can set them again on purpose. New StockLevels default to `INHERIT`. Existing movements get `tracked = NULL`, which falls back to today's behaviour, so no backfill is needed.

Steps for users: generate the v4 migration with the CLI, then add `await migrateTrackInventoryToChannels(queryRunner)` as the **first** line of `up()`. The generated drop of `global_settings.trackInventory` must run after it. The helper is a no-op once the column is gone. This ordering rule is the main footgun. A codemod or `vendure migrate` check could insert the call, the same way the role-assignment helpers are inserted.

Rollback: `down()` re-adds `global_settings.trackInventory` and should set it from the default channel's value. The new columns can be dropped. Allocations made under v4 with `tracked = false` are then read with the old rule (current flag), which brings back the existing bug for orders still open, not new corruption.

Why the variant flag is not copied to StockLevel: it stays as the variant layer. Copying it would denormalise the data and drop the setting for StockLevels created later.

## Breaking changes and impact

- **Admin API**: removed `GlobalSettings.trackInventory` and `UpdateGlobalSettingsInput.trackInventory` (clients get a validation error). Added `StockLevel.trackInventory: GlobalFlag!` and `StockLevelInput.trackInventory: GlobalFlag`. `Channel.trackInventory` now has an effect. `ProductVariant.trackInventory` is unchanged in shape but now means "variant default". `stockOnHand` and `stockAllocated` still sum all channel-applicable levels.
- **Shop API**: no schema change. `ProductVariant.stockLevel` and `addItemToOrder` limits now vary per channel and per location setting. That is the feature.
- **Dashboard** (not changed in the spike, must change for v4):
  - The global settings page queries the removed field, so the page breaks.
  - The fulfil dialog (`fulfill-order-dialog.tsx:66,109,132`) queries `globalSettings.trackInventory`, so **fulfilment breaks** until it is ported.
  - The variant page should show a per-location tracking select and the effective value.
  - The channel form should show `trackInventory`.
  - Recommend adding a server-resolved field (e.g. `StockLevel.tracksInventory: Boolean!` or `ProductVariant.tracksInventory`) so the dashboard stops re-implementing the resolution.
- **Plugins and strategies**:
  - Any code that reads `globalSettings.trackInventory` fails to compile. The field is gone from the entity.
  - Code that decides "tracked?" from `variant.trackInventory` alone is wrong when overrides exist. It should call `StockLevelService.isInventoryTracked()`.
  - A custom `StockLocationStrategy` keeps working: if it leaves `hasUntrackedStock` undefined, core falls back to the variant and channel. It just won't honour StockLevel overrides until it implements the hook.
  - `BaseStockLocationStrategy.getVariantStockSettings()` now resolves from the channel.
  - `DefaultStockLocationStrategy.getAvailableStock` became async (allowed by the interface).
- **Storefronts**: unaffected unless they read Admin settings.

## Risks

- **Ordering footgun in the migration** (likelihood medium, impact medium: every INHERIT variant silently flips to the channel's stored value, usually `true`). Mitigation: document it, make it fail loudly (e.g. bootstrap check: if `global_settings.trackInventory` was dropped without the helper being recorded, warn), consider a codemod.
- **Perf: an extra variant read per `getAvailableStock` call** (likelihood high, impact low to medium on product lists). Mitigation: pass the loaded variant to the strategy (new optional parameter) or batch the variant load in the existing DataLoader.
- **Ledger reads add 4 queries per (line, location) on release, sale and cancel** (high, low). Mitigation: one grouped query, or carry `tracked` in `LocationWithQuantity` from `getLocationsBasedOnAllocations`.
- **Shared locations across channels with different defaults confuse merchants** (medium, medium). Mitigation: docs, and a dashboard warning when a location is shared by channels whose `trackInventory` differs.
- **Third-party strategies that read `variant.trackInventory`** (medium, low). Mitigation: migration guide and the `isInventoryTracked` hook.
- **`getLocationsBasedOnAllocations` ignores earlier releases and sales** (existing; low). A partial release followed by a sale can pick the wrong location. The ledger clamps the figures, but the right fix is to subtract earlier movements there.

## Multi-channel fit

- Per-vendor and per-store inventory policy with no code: a marketplace channel that sells drop-shipped or made-to-order goods sets `Channel.trackInventory = false`. Stores with warehouses track. Today this needs a custom strategy and still corrupts figures on shared variants.
- Per-location control fits `MultiChannelStockLocationStrategy`: a vendor's own warehouse is tracked, a virtual "supplier" location is not, and an order can be split across them correctly.
- The ledger makes a vendor's settings change safe while other vendors' orders are open. That matters most when many vendors share an instance.
- Synergy with role assignments: `Channel.trackInventory` is edited with channel-scoped permissions (`UpdateChannel` on that channel), and StockLevel edits with `UpdateCatalog` or `UpdateProduct` on the channel that owns the location. A vendor admin can then run their own inventory policy without SuperAdmin, which a global setting could not offer.
- Search: `inStock` in the default search index is computed per channel ctx, so it becomes channel-correct for free.

### The default channel (effective trackInventory when settings disagree)

The orchestrator asked for this explicitly. Tracking is resolved per request, against the channel of the request (for allocation, the order's channel). In the default channel:
- `Channel.trackInventory` of the **default channel itself** is the channel layer. The migration sets it to the old global value, so a single-channel shop behaves exactly as before.
- The default channel contains every StockLocation (`ChannelService.assignToCurrentChannel` always adds it), so it sees every StockLevel. An explicit StockLevel `TRUE` or `FALSE` wins there as everywhere else. A level left at `INHERIT` resolves to the variant, then to the **default channel's** value, not to the value of the vendor channel that owns the location.
- So when settings disagree, the same StockLevel can be tracked in the default channel and untracked in vendor channel B (B has `trackInventory = false`, the default has `true`, and the level is `INHERIT`). Each order records what applied when it was allocated, so the figures stay consistent. But default-channel orders count that stock while B's orders don't. If a vendor wants a location untracked everywhere, the vendor should set `StockLevel.trackInventory = FALSE` (or the dashboard could offer "apply to the location's StockLevels"), not rely on the channel default.
- Saleable stock in the default channel with `MultiChannelStockLocationStrategy`: if any of the variant's StockLevels resolves as untracked there, the variant is unlimited, because allocation can be served from that location. With `DefaultStockLocationStrategy` (documented as single-location), the same rule holds, and the untracked location is allocated from.

## Cross-spike notes

- **Per-channel home, if the maintainer wants one anyway (orchestrator note 1)**: it should be a nullable `trackInventory: GlobalFlag` column (default `INHERIT`) on OSS-1000/OSS-1001's `ProductVariantChannel` entity, so the migrations combine. The resolution order becomes StockLevel → ProductVariantChannel → ProductVariant → Channel. The prototype's `resolveTrackInventory()` takes one more optional input, and the ledger is unaffected. I still don't recommend it: it adds a fourth layer for a need that StockLevel overrides and the Channel default already cover, and it carries the shared-location hazard described in option (b).

- **OSS-1001 (per-channel `enabled`)**: do **not** put `trackInventory` on the ProductVariant–Channel join row, even if it becomes an explicit entity. Tracking belongs to stock (location), and channels already reach stock through StockLocation–Channel. The per-channel need is met by `Channel.trackInventory` plus StockLevel overrides. If OSS-1001 adds `enabled` per channel, a disabled variant is simply not saleable. No interaction with tracking beyond the saleable check order: check `enabled` first.
- **OSS-1001 / OSS-1000**: both may add channel-scoped resolution order. Use one documented "most specific wins" convention (entity in context → entity → channel) across all three.
- `Channel.outOfStockThreshold` is equally dead. Whoever owns "per-channel catalogue settings" should move both together.
- Shared with all lanes: removing a deprecated GlobalSettings field needs a data helper that runs before the generated drop. Consider one combined `v4_0` helper that runs every lane's pre-drop copies.

## Open questions for the maintainer

1. Remove `GlobalSettings.trackInventory` in v4.0, or keep it as a deprecated, write-through alias for the default channel? **Default: remove.** It was already deprecated, and an alias would hide the new per-channel meaning.
2. Should `StockLocation` also get a `trackInventory` default (e.g. "the whole drop-ship location is untracked")? It would sit between StockLevel and variant, which makes "variant says TRUE, location says FALSE" ambiguous. **Default: no for 4.0.** Add a bulk "set tracking for all levels at this location" action instead.
3. Move `outOfStockThreshold` to Channel (and StockLevel) in the same release? **Default: yes, Channel only, as a follow-up ticket.**
4. Should a tracked-at-sale but untracked-at-allocation unit decrement `stockOnHand` on shipment? **Default: no.** Tracking is fixed per unit at allocation. This is simple and consistent, and it is what the prototype does.
5. Expose a resolved `tracksInventory: Boolean!` on `StockLevel` (and on `ProductVariant` in the active channel) for the dashboard and integrations? **Default: yes.**

## Effort estimate

| Work | Low | Likely | High |
| -- | -- | -- | -- |
| Core: harden prototype (perf of variant read and ledger, location-aware release picking, docs) | 2 | 3 | 5 |
| Unit and e2e test updates (21 unit, concurrency on postgres and mysql) | 1.5 | 2.5 | 4 |
| Migration helper, guide, bootstrap guard, optional codemod | 1 | 1.5 | 3 |
| Dashboard (global settings, fulfil dialog, variant per-location select, channel form, resolved field) | 2 | 3 | 5 |
| `outOfStockThreshold` to Channel (optional) | 1 | 1.5 | 2 |
| **Total** | **7.5** | **11.5** | **19** |
