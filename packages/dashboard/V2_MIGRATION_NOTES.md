# Dashboard Design System v2 — Migration Notes

Upgrade notes for **extension authors** moving an existing Vendure Dashboard
extension onto the v2 design system (`@vendure-io/ui@2.x` /
`@vendure-io/design-tokens@2.x`).

These are the **deliberate breaking changes**. They are intentional and will not
be shimmed. Each entry gives the change, who is affected, and how to migrate.

> Import everything from `@vendure/dashboard`. Deep imports from
> `@/vdb/...` are internal paths and are not part of the public API contract —
> some have moved or been removed in v2 (see below).

---

## 1. `Badge` — `secondary` variant removed

The `secondary` variant alias has been removed from the dashboard `Badge`
wrapper. It was a v1 hold-over and no longer maps to anything in the v2 badge
atom.

**Affected:** any extension rendering `<Badge variant="secondary">`.

**Migrate:** use the neutral default variant — drop the prop.

```tsx
// Before (v1)
<Badge variant="secondary">{label}</Badge>

// After (v2)
<Badge>{label}</Badge>
```

The dashboard `Badge` still adds the `success` and `warning` variants on top of
the base atom's variants; those are unchanged.

---

## 2. `CopyableText` — container element changed from `<div>` to `<span>`

`CopyableText` now renders its container as an inline `<span>` instead of a
block-level `<div>`.

**Affected:** extension CSS that targeted the `CopyableText` container assuming a
block box — e.g. relying on default block layout, `width`, vertical margins, or a
descendant selector that expected a `div`.

**Migrate:** the component no longer establishes a block context of its own. If
you need block behaviour, wrap it or set `display` explicitly via the
`className` prop:

```tsx
<CopyableText value={entity.id} className="block">
    <span className="font-mono text-sm">{entity.id}</span>
</CopyableText>
```

Presentation of the children is, as before, entirely consumer-controlled — the
component applies no styling to them.

---

## 3. `state-type` helpers removed — use the state-dictionary toolkit

The old tone/variant helpers have been removed from the
`@/vdb/utils/state-type.js` deep-import path:

- `getTypeForState(state)` — removed
- `stateTypeToBadgeVariant(type)` — removed
- `StateType` type (`'default' | 'destructive' | 'success' | 'warning'`) — removed

They are replaced by the state-dictionary toolkit, exported from the public API:
`defineStateEntries` plus the `Tone` vocabulary, driving the v2 `StatusBadge`.

**Tone vocabulary (v2):** `'neutral' | 'info' | 'success' | 'warning' | 'critical' | 'progress'`.
Note `critical` replaces the old `destructive`, and a state map falls back to
`neutral` for any unlisted state (there is no `default`).

**Migrate:** declare a state → tone map once with `defineStateEntries`, then read
`toneFor(state)` into a `StatusBadge`:

```tsx
// Before (v1) — deep import, now gone
import { getTypeForState, stateTypeToBadgeVariant } from '@/vdb/utils/state-type.js';
import { Badge } from '@vendure/dashboard';

const variant = stateTypeToBadgeVariant(getTypeForState(order.state));
<Badge variant={variant}>{order.state}</Badge>;
```

```tsx
// After (v2)
import { StatusBadge, defineStateEntries } from '@vendure/dashboard';

const myStates = defineStateEntries({
    Completed: { tone: 'success', defaultLabel: 'Completed' },
    Pending: { tone: 'warning', defaultLabel: 'Pending' },
    Error: { tone: 'critical', defaultLabel: 'Error' },
});

<StatusBadge tone={myStates.toneFor(order.state)}>{order.state}</StatusBadge>;
```

For **order/payment/fulfillment** states specifically, you no longer need to
build your own map — the dashboard's canonical dictionary is now public:

```tsx
import { StatusBadge, orderStateDictionary } from '@vendure/dashboard';

<StatusBadge tone={orderStateDictionary.toneFor(order.state)}>
    {order.state}
</StatusBadge>;
```

> Behaviour change to be aware of: in the v2 dictionary a **`Cancelled`** order
> resolves to `neutral` (a terminal outcome), not to the old red
> `destructive`/`critical` treatment. Hard failures (`Declined`, `Error`) are
> `critical`.

---

## 4. Brand ramp aliases removed from the theme (`--color-brand-lighter` / `--color-brand-darker`)

The theme plugin no longer emits the `--color-brand-lighter` and
`--color-brand-darker` custom properties, so the Tailwind utilities that mapped
to them (`bg-brand-lighter`, `bg-brand-darker`, `text-brand-lighter`,
`border-brand-darker`, …) no longer exist.

(For reference, in v1 `brand-lighter` mapped to `brand[300]` in light theme /
`brand[50]` in dark, and `brand-darker` to `brand[700]`.)

**Affected:** extension markup or CSS using any `*-brand-lighter` / `*-brand-darker`
utility.

**Migrate:** use the semantic `brand` token, which v2
`@vendure-io/design-tokens` publishes and the theme forwards automatically:

- `bg-brand`, `text-brand`, `border-brand`
- `text-brand-foreground` for content sitting on a brand-colored surface

For a lighter/tinted brand surface, use an opacity modifier on `brand` — the same
tonal pattern the dashboard uses for its own `success`/`warning` badges:

```tsx
// Before (v1)
<div className="bg-brand-lighter text-brand-darker">…</div>

// After (v2)
<div className="bg-brand/10 text-brand">…</div>
```

If you genuinely need discrete ramp steps, the full numeric brand scale
(`brand-50` … `brand-950`) is still exported from `@vendure-io/design-tokens`
for programmatic use and theme overrides — but it is **not** emitted as
ready-made utility classes. Prefer the semantic `brand` token with an opacity
modifier over hard-coding ramp steps.

---

## 5. `Money` / `DateTime` now render through the shared `@vendure-io/ui` molecules

The dashboard `Money` and `DateTime` display components are now thin adapters
over the `@vendure-io/ui` `Money` / `DateTime` molecules. Locale and minor-unit
precision (`moneyStrategyPrecision`) are supplied app-wide via a `FormatProvider`
bridge mounted at the app root, so formatting still tracks the user's display
language/region and the server's money precision exactly as before. **The public
props are unchanged** — `Money` still takes `{ value, currency }` (currency
per call site, from your data) and `DateTime` still takes `{ value }`.

Two behaviours changed at the DOM/output level:

- **`Money` now renders a `<span data-slot="money" class="tabular-nums">`** around
  the formatted amount, instead of a bare text node. When a `currency` is passed
  the formatted string is identical to before. When `currency` is omitted the
  amount is still shown as a plain number (no currency symbol), but now with
  fixed minor-unit decimals (e.g. `25.00` rather than `25`).
- **`DateTime` still renders the two-line date-over-muted-time stack**, but the
  two inner elements are now semantic `<time data-slot="date-time">` elements
  instead of `<div>`s. Invalid/empty input now renders `—` rather than the raw
  string.

**Affected:** extension CSS or DOM queries that targeted the previous element
structure (a bare `Money` text node, or `DateTime`'s inner `<div>`s), or that
depended on `Money` omitting decimals when no currency was given.

**Migrate:** target the `data-slot` attributes if you need to style these, and
pass a `currency` wherever the amount represents real money. Presentation is
otherwise unchanged.

---

## 6. `MultiSelect` — rebuilt on the v2 primitives (props unchanged, markup changed)

The dashboard `MultiSelect` wrapper no longer renders its own hand-rolled popover
+ badge + search-box UI. **The public props are unchanged** — it still takes
`{ value, onChange, multiple, items, placeholder, searchPlaceholder, showSearch,
className }`, where each item is `{ value, label, display? }`, `value` is a
`string[]` when `multiple` and a `string` otherwise, and (as before) a filter
input appears when `showSearch` is set or the list has more than ten items. It
now composes the v2 primitives underneath, and which primitive depends on
whether a filter is shown:

| Mode | Filter shown (`showSearch` or > 10 items) | No filter |
| --- | --- | --- |
| `multiple` | `@vendure-io/ui` **`Combobox`** — removable chips + inline filter input | `@vendure-io/ui` **`MultiSelect` molecule** (multi-value select) |
| single | `@vendure-io/ui` **`Combobox`** — type-to-filter input | `@vendure-io/ui` **`Select` atom** |

**Behaviour/markup changes to be aware of:**

- The DOM is entirely different from v1 — there is no longer a `Button` trigger
  wrapping `Badge` chips inside a `Popover`. Filtered modes render Base UI
  Combobox parts (`[data-slot="combobox-chips"]`, `[data-slot="combobox-chip"]`,
  `[data-slot="combobox-content"]`, …); unfiltered modes render Select parts.
- **Non-filtered multi-select** (short lists) summarises the selection as
  comma-separated labels in a select trigger rather than removable chips —
  deselect by reopening and toggling. **Filtered multi-select** keeps removable
  chips (each with an inline `×`), so long lists behave like v1.
- Selected-option `display` nodes are still honoured in the list, chips and
  trigger summary.

**Affected:** extension CSS or DOM queries that targeted the old
popover/badge/button structure. The prop contract itself needs no changes.

**Migrate:** if you styled or queried the old internals, retarget the Combobox
/ Select `data-slot` attributes above. No prop changes are required.

---

## 7. `DataTable` row selection & bulk actions — realigned to the v2 spec (props unchanged, markup changed)

The dashboard `DataTable` / `PaginatedListDataTable` **public prop contracts are
unchanged**. The row-selection and bulk-action *treatment* now follows the
`@vendure-io/ui` `molecules/data-table` spec:

- **Selection checkboxes are revealed on demand.** The per-row and header
  select-all checkboxes are floated over a zero-width leading cell and stay
  `opacity-0` until the row (or header row) is hovered, the checkbox is
  keyboard-focused, or it carries a checked/indeterminate state. The gutter is
  folded into the leading data column as left padding (`pl-8`), so an idle table
  reserves no visible checkbox column. Selected rows use the `data-[state=selected]`
  background from the v2 table atom.
- **The bulk-action bar is a distinct in-flow bar, not an overlay.** When a
  selection is active it replaces the toolbar controls row with a plain
  `[data-slot="data-table-bulk-actions"]` row carrying the selection count, the
  Actions menu and a clear-selection control (it takes the controls row's place
  inside the table's header band — see entry 8 — so it carries no box chrome of
  its own). The previous treatment was an absolutely-positioned overlay drawn
  over a dimmed toolbar. The redundant select-all checkbox that used to live
  inside the bar was removed — select-all is the table header checkbox.

**Affected:** extension CSS or DOM queries that targeted the old selection column
markup or the old absolute bulk-action overlay; automated tests that asserted on
those internals. Row checkboxes are still `role="checkbox"` inside each row and
remain clickable (`opacity-0` is still hit-testable and hover precedes the click).

**Migrate:** if you styled or queried those internals, retarget the
`[data-slot="data-table-bulk-actions"]` bar and the row/header checkboxes. No
prop changes are required.

---

## 8. `DataTable` — the card is now the table's frame (props extended, markup changed)

The dashboard `DataTable` / `PaginatedListDataTable` are now thin bridges over
the `@vendure-io/ui` `molecules/data-table` composition root. **All existing
props keep working**, but every table changes appearance automatically:

- The table renders on a `Card` (`[data-slot="data-table"]`): the toolbar
  (search, filters, view options, refresh) is anchored in a `CardHeader` band
  with a bottom divider; the rows run flush to the card edges (edge cells carry
  the card's content padding); pagination sits in a `CardFooter` band with a top
  divider. Tables without pagination end flush at the card's bottom edge.
- The old free-floating toolbar row and separately-boxed table wrapper are gone.
  There is no `[data-slot="card"]` wrapper *around* the table anymore — the card
  root **is** the table.
- Row heights follow the v2 table atom's cell padding instead of the previous
  fixed `h-12` cells.

New opt-in props on both components:

- `title` — a heading rendered inside the header band (used by detail-page
  tables such as "Product variants"; the surrounding `PageBlock` no longer
  renders a title of its own for these).
- `actions` — CTA buttons (e.g. "Manage variants") rendered in the header band
  next to the view-options/refresh controls, instead of floating below the
  table.
- `frame` — `'card'` (default) or `'plain'`. Pass `'plain'` for a table embedded
  in an existing card (e.g. an Insights widget): the band structure renders
  without card chrome and resolves its spacing against the host card's
  `--card-px`/`--card-gap` variables.
- `footerRows` — rows appended after the data rows inside the table body
  (e.g. the order table's totals). Accepts a node or
  `({ columnCount }) => ReactNode`; the function form receives the current
  visible column count for `colSpan`s. `children` keeps working as before and
  maps to the same slot.

**Affected:** extension CSS or DOM queries that targeted the old wrapper
(`overflow-hidden rounded-xl border ...` around the `<table>`), the old toolbar
position, or fixed row heights; screenshots/visual baselines.

**Migrate:** no prop changes are required. If you styled or queried the old
internals, retarget the card frame (`[data-slot="data-table"]`) and its
`[data-slot="card-header"]` / `[data-slot="card-table"]` /
`[data-slot="card-footer"]` bands. If your extension renders a `DataTable`
inside its own `Card`, pass `frame="plain"`.

## 9. `DataTable` toolbar — decrowded controls, merged settings menu, page-aware search

The toolbar of every `DataTable` has been reorganised to reduce the number of
competing bordered surfaces:

- The search input's placeholder is now configurable via a new
  `searchPlaceholder` prop on `DataTable` / `PaginatedListDataTable` /
  `ListPage` (e.g. `"Search products..."`). The default changed from
  `"Filter..."` to `"Search..."`. All core list pages pass a page-aware value.
- The standalone column-settings and refresh buttons have been merged into a
  single table-settings dropdown (an `⋮` icon button). It contains a
  **Refresh** item and the column visibility/order controls with **Reset**.
  The trigger keeps the `dt-column-settings-trigger` testid; the refresh item
  keeps `dt-refresh-button` — tests that clicked the refresh button directly
  must now open the settings menu first. "Save View" remains a standalone
  button (it only appears when the current filters are unsaved).
- The add-filter and my-views icon triggers use the `secondary` button variant
  (filled, borderless) instead of `outline`; applied-filter chips use a solid
  border instead of dashed; the faceted-filter count badges are `secondary`
  instead of `default`; the vertical separators between toolbar zones are gone.

**Affected:** tests that clicked `dt-refresh-button` as a toolbar button;
CSS/DOM queries targeting the old outline/dashed toolbar controls;
screenshots/visual baselines.

**Migrate:** open the settings menu (`dt-column-settings-trigger`) before
clicking `dt-refresh-button`. Pass `searchPlaceholder` on list pages where the
generic "Search..." is too vague.

The standalone `DataTableViewOptions` and `RefreshButton` components remain
exported and functional for extension use, but the core tables no longer render
them.

## 10. `BooleanDisplayBadge` / `vendure:booleanBadge` — emphasis flipped to the exceptional state

Boolean state badges no longer highlight the expected default. Previously
`true` rendered as a green `success` badge and `false` as a plain badge, so
default-heavy columns (e.g. `enabled` in the product list) showed a green chip
on nearly every row. `BooleanDisplayBadge` now renders through `StatusBadge`
with `true` → `neutral` and `false` → `critical`: the calm tone marks the
expected state, the accent marks the deviation worth spotting.

This applies wherever the component is used — the `vendure:booleanBadge`
display component, the auto-generated list column for fields named `enabled`,
and the core list pages that render enabled/disabled state.

**Affected:** extensions using `BooleanDisplayBadge` or `vendure:booleanBadge`
for booleans where `true` is *not* the expected default, or where the green
"success" reading was load-bearing; screenshots/visual baselines.

**Migrate:** nothing to change for enabled-style flags — the flip is the
intended reading. For lifecycle or outcome states where color should encode the
value itself (completed/failed), use `StatusBadge` with a state dictionary
(`defineStateEntries`) instead of a boolean badge.
