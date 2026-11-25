---
name: vendure-store-setup
description: >-
  Set up the base data of a Vendure store: currency, languages, whether prices
  include tax, zones, tax categories and rates, shipping, payment and stock
  locations. Use when a new project needs its starting setup, when choosing or
  applying a base-data preset with `vendure seed`, or when changing a store's
  tax, zone, shipping or payment setup with the Vendure MCP admin tools.
allowed-tools: Bash, Read
---

# Vendure store setup

A store needs base data before it can take an order: the channel's currency and
languages, whether prices include tax, zones, tax categories and rates, a
shipping method, a payment method and a stock location.

There are two ways to get it:

- **A preset**, once, on an empty database.
- **The MCP admin tools** (or the Dashboard) for everything after that. A preset
  never changes a store that is already set up.

## Presets

Run `vendure` through the project's package manager (for example `npx vendure`),
as the `vendure-cli` skill describes.

List them with `vendure seed`. Each preset:

- sets the default channel's currency, languages and `pricesIncludeTax`;
- creates every country, enabled;
- creates one zone, used as the default tax and shipping zone;
- creates tax categories and their rates;
- creates a `Flat rate` shipping method at 5.00 in the channel currency, which
  the merchant sets with `admin_update_shipping_method`;
- creates a `Test payment` method, outside production and only when
  `dummyPaymentHandler` is configured;
- reuses the default stock location.

| Preset | Currency | Prices | Tax |
| --- | --- | --- | --- |
| `uk` | GBP | include VAT | Standard 20, Reduced 5, Zero 0 |
| `us` | USD | exclude tax | Standard at 0: use a tax provider |
| `au` | AUD | include GST | Standard 10, Zero 0 |
| `single-country --country NZ --currency NZD` | any | include tax | Standard at 0: set your rate |
| `eu --country DE` | EUR | include VAT | Standard and reduced per member state |

`eu`'s `--country` is the seller's own member state. The preset sets it as the
channel's tax country, so its rates are the ones entered prices include.

### Applying a preset

- Recorded: `vendure seed --first-run` applies the preset and scenario that
  `.vendure/create.json` records, once per database. It is safe to run on every
  start: an already seeded database returns at once.
- On demand: `vendure seed --preset <name> [--country XX] [--currency XXX]`.

Known issue in the 4.0 previews: in a Vendure Cloud app (`defineCloudConfig()`),
`vendure seed --preset` and `vendure seed --first-run` with a recorded preset fail
with "Could not find the VendureConfig declaration in your project". A later preview fixes it. Until then, set
the store up with the MCP admin tools below, and check it with `vendure store check`.

Rules that matter when something looks wrong:

- A preset runs only on an empty database. If the database has countries, zones,
  tax categories or rates, shipping or payment methods, products or a second
  channel, it fails with `core.preset-database-not-empty`. Never empty a database
  to make a preset run; change the store with the tools below.
- Each database records what it was seeded with in the settings store
  (`vendure.seed.preset`, `vendure.seed.scenario`, SuperAdmin only; read them with
  `admin_get_setting`). So each database is seeded once, and checkouts that share
  a database share the record.
- `vendure seed --first-run --json` reports each step as `applied`,
  `already-applied`, `skipped` (with a reason) or `failed`. A database that was
  set up by hand is `skipped` and never written to. A failed scenario is retried
  on the next run.

## Changing the setup with the MCP admin tools

Over `vendure mcp` the tools carry an `admin_` prefix; on the store's own MCP
server they have none. Start with `admin_check_store`: it lists what stops the
store taking an order, and most findings name the tool call that fixes them.

| Task | Tools |
| --- | --- |
| Currency, languages, prices include tax, default zones | `admin_get_channel`, `admin_update_channel` |
| Countries | `admin_list_countries`, `admin_enable_countries` |
| Zones | `admin_list_zones`, `admin_create_zone`, `admin_update_zone`, `admin_delete_zone` |
| Tax categories | `admin_list_tax_categories`, `admin_create_tax_category`, `admin_update_tax_category`, `admin_delete_tax_category` |
| Tax rates | `admin_list_tax_rates`, `admin_create_tax_rate`, `admin_update_tax_rate`, `admin_delete_tax_rate` |
| Shipping | `admin_list_shipping_methods`, `admin_create_shipping_method`, `admin_update_shipping_method`, `admin_delete_shipping_method` |
| Payment | `admin_list_payment_methods`, `admin_create_payment_method`, `admin_update_payment_method`, `admin_delete_payment_method` |
| Stock locations | `admin_list_stock_locations`, `admin_create_stock_location`, `admin_update_stock_location`, `admin_delete_stock_location` |

A tax rate targets either a country (`target: {countryCode}`) or a zone
(`target: {zoneId}`). For a buyer's country, a country rate wins over a zone
rate. In a store whose prices include tax, the default tax zone needs a zone
rate per tax category: it is the rate the entered prices include, and
`admin_check_store` reports a missing one for each tax category the channel's
products use. A category no product uses yet is not checked.

## Regional guidance

These are starting points, not tax advice. The merchant confirms rates with their
accountant or tax authority.

- **UK VAT.** Prices include VAT. Standard 20, reduced 5 (for example domestic
  energy, children's car seats), zero 0 (most food, books, children's clothes).
  Assign each product the matching tax category.
- **EU One-Stop Shop.** A seller registered for OSS charges the buyer's country
  rate on cross-border sales to consumers. Use one country rate per member state
  and category, in one `EU` zone that is the channel's default tax zone, and set the
  channel's tax country (`taxCountryCode`) to the seller's own member state: its
  rate is the one entered prices include. Rates change every year: check
  them against the European Commission's published rates.
- **US sales tax.** Rates depend on the state, county and city of the address, and
  on whether the seller has nexus there. Static rates are not workable: install a
  tax provider integration (a custom `TaxLineCalculationStrategy`). The `us`
  preset's 0 rate only lets orders calculate until then. Prices exclude tax.
- **AU GST.** Prices include GST at 10. GST-free goods (most basic food, some
  health and education) use the zero category.
- **CA GST, PST, QST and HST.** GST is 5. Some provinces add PST or QST on top
  of GST. Others charge HST, which replaces both. In Vendure 4.0 a tax rate can
  target a country or a zone, not a province, and one tax category gives one rate
  per address, so use a tax provider. Start from
  `single-country --country CA --currency CAD`, then set `pricesIncludeTax` to
  false with `admin_update_channel`: Canadian prices are shown before tax.
