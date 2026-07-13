# Design System v2 Migration — Open Questions

Questions and decisions collected during the migration of `@vendure/dashboard` to
`@vendure-io/ui@2.0.0-beta.x` / `@vendure-io/design-tokens@2.0.0-beta.x`, to be
resolved before this PR leaves draft. This file is deleted before merge.

## Visual / UX decisions

1. **Link color.** v2 repurposes `primary` as a near-black action color; the blue
   moved to the new `brand` slot. Hyperlinks styled with `text-primary` were blue in
   v1 and are now near-black: `src/lib/components/shared/asset/asset-properties.tsx:23`
   and the rich-text-editor link styles (`rich-text-editor.tsx:28`). Keep near-black,
   or switch links to `text-brand`?
2. **Default-address chips.** `customer-address-card.tsx:93,98` use
   `bg-primary/10 text-primary` for "Default Shipping/Billing" chips. Neither brand
   nor a primary action — v2's new `neutral-subtle` slots fit better. Change them?
3. **Cancel actions lost their red.** The state-transition dropdown derived
   destructive styling from the *target state's* tone; Cancelled is now correctly
   neutral, so "Cancel order/payment" menu items are no longer red. Same root cause
   in `order-process-dialog.tsx:828`: the guard that excluded destructive next
   states from the dashed "suggested state" treatment keys on `tone === 'critical'`,
   so Cancel transitions now *get* the suggested styling the adjacent comment says
   to avoid. Recommendation: key destructive styling on the action semantics
   (cancel = irreversible loss) rather than the state tone. Confirm and we'll
   special-case both sites.
4. **Scheduled task "Running" column** now uses the `progress` tone (pulsing dot)
   instead of `success`. This follows the state rules (actively executing = progress)
   but deviates from the previous look. Confirm.
5. **Destructive confirmation dialogs.** There are 5 `ConfirmationDialog` call sites
   in 4 files; 4 are destructive deletes (incl. two in
   `products_.$id_.variants.tsx:322,460`), while
   `generate-variants-panel.tsx:402` is a discard/navigation confirm. The adapter
   keeps the previous non-destructive appearance to avoid a silent visual change.
   v2's ConfirmDialog supports `variant="destructive"` — add a `destructive` prop
   and use it at the 4 delete sites?
   Note: the v2 dialog also awaits promise-returning `onConfirm` handlers — it stays
   open with a spinner, blocks escape/backdrop while pending, and stays open on
   rejection, where the old wrapper closed immediately. Current call sites are sync,
   so no behavior change today, but future async handlers get this for free.
6. **Dialog title typography.** v2 dialog/alert-dialog titles use the
   `text-style-section-title` role (family + size + weight) where the dashboard
   previously only re-bound the font family. Real visual change on every dialog —
   needs a design eyeball.
7. **Focal-point marker.** `asset-focal-point-editor.tsx:43` keeps `border-white`
   (deliberate fixed contrast over arbitrary user images) behind a justified
   design-lint disable. If this concept recurs, it should become a named semantic
   slot (e.g. `overlay-on-media`) in the token package.
8. **Global visual QA.** v2's `primary` change shifts every primary button, ring and
   selection accent from blue to near-black — intended by the DS, but the dashboard
   should get a full visual pass (storybook / dev-server) before this leaves draft.

## API / technical decisions

9. **Badge `secondary` alias.** v2 removed the variant; the dashboard Badge wrapper
   keeps it as a deprecated alias of the neutral `default` so extensions don't break
   on a minor. All internal call sites are migrated. Drop the alias in the next major?
10. **`input.tsx` fork.** v2's input atom no longer wraps Base UI `Field.Control`,
    so the original react-hook-form `isDirty` conflict is likely gone — but the fork
    also null-coalesces `value`, which the atom doesn't. Needs an isDirty re-test
    against the v2 atom before deleting the fork.
11. **Error page granularity.** The rebuilt error page is generic: route
    `errorComponent`s pass only `error.message`, discarding status. Distinguishing
    not-found / permission / generic failure (with the matching illustration and
    navigation instead of retry) requires an `ErrorPageProps` change across ~30
    route callers. Take it on in this PR or as a follow-up?
12. **Latest-orders widget error state.** `PaginatedListDataTable` never exposes
    `isError`, so the widget cannot render an ErrorState. Add an error seam to the
    shared component?
13. **DataTable first-run empty CTA.** The new first-run EmptyState deliberately has
    no create action (the table cannot know the page's create route). If we want
    "create your first X" CTAs, the table and paginated wrapper need an optional
    empty-state action prop.
14. **`orderStateDictionary` visibility.** Kept internal; extensions get the generic
    `defineStateEntries`/tone toolkit via the public API. Should the concrete order
    dictionary also be public?
15. **CopyableText DOM change.** The v2 molecule renders an inline `<span>` container
    where the old component was a block `<div>`. No internal breakage; extension CSS
    targeting the container could notice.
16. **Removed `state-type` helpers.** `getTypeForState`/`stateTypeToBadgeVariant`/
    `StateType` were never in the generated public index, but extensions could reach
    them via the documented `@/vdb/utils/state-type.js` deep-import path. They were
    removed outright (replaced by the state-dictionary toolkit) — a deliberate break
    for deep-importers. Add deprecated shims instead?
17. **Upstream i18n gaps in v2 molecules.** The v2 CopyButton hard-codes English
    aria-labels ("Copy"/"Copied") and CopyableText doesn't forward label props, so
    the dashboard wrapper can't localize them; LoadingState likewise hard-codes an
    sr-only "Loading…". Needs upstream prop passthroughs in `@vendure-io/ui`.
18. **Removed brand ramp aliases.** The theme plugin no longer emits
    `--color-brand-lighter`/`--color-brand-darker` (unused internally, not published
    by v2). Any extension using `bg-brand-lighter` etc. silently loses the utility.
19. **Minor status-badge polish.** The job-queue RUNNING badge now shows the
    progress dot *and* the static state icon (double indicator — consider dropping
    the icon for RUNNING), and the dashboard Badge's custom success/warning variants
    inherit the neutral border rather than `border-success-border`/
    `border-warning-border` as v2 StatusBadge does.
20. **design-lint false positive.** Issue references like `(#2608)` in test titles
    parse as hex colors, so `src/**/*.spec.{ts,tsx}` is excluded from the rule
    (inline disables are impossible: the root pre-commit ESLint doesn't know the
    plugin). Worth an upstream fix in `@vendure-io/design-lint` (require a
    non-hex boundary after `#`).

## Deferred to follow-up PRs (with reasons)

- **multi-select**: v2 molecule is multi-only, searchless, and has a different value
  contract (`itemToValue`/`onValueChange`); the dashboard's is used at 7 call sites
  including single-select modes. Wholesale rewrite, not an adapter.
- **date-range-picker / datetime-input**: v2 pickers are date-only string-valued;
  the dashboard needs instants with time-of-day boundaries (analytics ranges) and a
  form-engine prop shape. Value-semantics mismatch.
- **Money / DateTime / FormatProvider**: v2 molecules read a `FormatProvider`
  context that would compete with the host-owned `useLocalFormat` system. Adopting
  means bridging or replacing the formatting context app-wide — its own project.
  (The `currency: 'USD'` fallback smell in the local Money was fixed regardless.)
- **DataTable suite** (~4.5k lines) vs v2 `molecules/data-table/*` — the largest
  convergence, needs its own design + migration plan (saved/global views stay
  consumer-owned).
- **app-shell / page-header** structural adoption — needs design intent review.
- **Motion + extended typography tokens**: v2 ships `animation`/`keyframes` and
  `textStyles` token groups that the theme plugin doesn't emit yet (keyframes need a
  different emission mechanism than the flat key→value groups).
- **lucide-react skew**: dashboard pins `^0.475.0`, v2 ui depends on `^0.575.0` —
  two icon versions in the bundle until the dashboard bumps.
- **Baseline lint debt**: `bun run lint` (`eslint .`) fails with ~12k pre-existing
  errors in the `**/*.{js,jsx}` block (scripts, e2e helpers) — untouched by this PR.
