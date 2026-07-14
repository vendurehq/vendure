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
