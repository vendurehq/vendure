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
