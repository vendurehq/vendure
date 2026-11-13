# OSS-1007: dashboard timezone findings

Scope: `packages/dashboard/src`, the `@vendure-io/ui@2.0.1` date molecules (`date-time-picker`, `date-range-picker`, `date-picker`, `date-time`, `lib/date-value.ts`), and the DashboardPlugin `MetricsService` (`packages/dashboard/plugin`).

Harness: `packages/dashboard/src/lib/__tz-spike__/tz-spike.spec.ts`. It imports the real `buildDateTimeFilter`, `parseDateTimeFilter`, `formatScalarArgValue` and `createFormSchemaFromFields`. Component-internal logic is copied verbatim, with citations. The server side is modelled in UTC with `@date-fns/tz` `TZDate`. Run it from `packages/dashboard`:

```
TZ=<zone> bunx vitest run --config src/lib/__tz-spike__/vitest.tz-spike.config.mts
```

All 15 tests pass in UTC, Europe/Vienna, America/Los_Angeles and Asia/Kolkata. The tests assert the current (buggy) behaviour. Raw output is in `.spike/results/dashboard-results-*.txt`.

The server values are assumed to be correct instants. This file covers only the dashboard's own discrepancies.

## (a) Findings

| id | location | user action | TZ affected | expected | actual (verified) | error | mechanism | severity |
|---|---|---|---|---|---|---|---|---|
| F-01 | plugin/service/metrics.service.ts:48-49,81,119-121,136-149; plugin/config/metrics-strategies.ts:36; metrics-widget/index.tsx:52-53,67 | Metrics chart, pick 2026-03-29..29 | any browser zone ≠ server's (LA, Vienna, Kolkata) | 1 bar "Mar 29" = local day | LA sends 03-29T07:00Z..03-30T06:59:59.999Z. The server queries 03-29T00:00Z..03-30T23:59:59.999Z and returns 2 buckets labelled "Mar 28","Mar 29" (UTC days 29 and 30). Vienna/Kolkata: "Mar 28","Mar 29" (extra day). A March range gives 32 buckets; LA labels "Feb 28".."Mar 31". | +1 day per range (2× for 1 day); LA labels −1 day; split at server midnight | server re-normalises in server zone, buckets by DB date; client formats a UTC-midnight label in local zone | High |
| F-02 | orders-summary/index.tsx:22-28,47-58 + F-01 | Orders Summary Today / any range | any browser zone ≠ server's | local-range totals, non-overlapping previous period | LA: current {29,30}, previous {28,29}. Vienna/Kolkata: {28,29} vs {27,28}. UTC: {29} vs {28}. | counts up to ~2×; % change biased | sums all widened buckets | High |
| F-03 | data-table-datetime-filter.tsx:11,62-79; ui date-time-picker.tsx:52-57 | filter orderPlacedAt "on 2026-03-29" | all | [local 00:00, next 00:00) | LA `eq` = `{"eq":"2026-03-29T07:00:00.000Z"}` → ~0 rows. `between 29..29` has start=end. `between 29..30` leaves out the 30th (Vienna end 03-29T22:00Z, Kolkata 03-29T18:30Z). | 0 results / missing last day | datetime picker emits local-midnight instants; `eq` compares instants | Medium |
| F-04 | use-saved-views.ts:33 (global views); data-table-filter-badge.tsx:97-101 | shared global view across zones | W/E | product decision | Instants are replayed unchanged. Stored 03-29T00:00Z..23:59Z shows badge "3/28/26 .. 3/29/26" (LA) and "3/29/26 .. 3/30/26" (Vienna/Kolkata). | ±1 day on the badge | instants, not calendar dates | Medium (product) |
| F-05 | ui date-time-picker.tsx:52-57 | re-pick a day on a value in the repeated fall-back hour | DST zones | instant unchanged | Vienna 2026-10-25T01:30Z→00:30Z; LA 2026-11-01T09:30Z→08:30Z. The second occurrence can't be entered. | −60 min | `setHours` resolves an ambiguous time to the earlier offset | Low |
| F-06 | ui date-time-picker.tsx:60-69 | type 02:30 on spring-forward day | DST zones | warning | Vienna 03-29 → 01:30Z, shown 03:30. LA 03-08 → 10:30Z, shown 03:30. | +60 min, silent | `setHours` normalises a non-existent time | Low |
| F-07 | ui date-time-picker.tsx:47-50,95,108-116; datetime-input.tsx:39-47 | any datetime entry | all | zone shown | Trigger shows the date only, with no zone. Time is HH:mm. The time box is disabled until a date is picked, so the first pick is 00:00 local. Seconds/ms are dropped (10:15:42.123→10:15:00). | info / <60 s | UI design | Low |
| F-08 | promotions_.$id.tsx:179-201 | Ends at = pick 31 Dec | all | end of 31 Dec | 31 Dec 00:00 local (LA 2026-12-31T08:00Z) | −1 day of validity | default time 00:00 | Low-Med |
| F-09 | form-schema-tools.ts:87-91,101-127 (msg 105-106) | `datetimeMin '2026-01-01'` | W and E | message matches the boundary | LA: "Date must be after 12/31/2025". Vienna/Kolkata: Jan 1 00:00 local is rejected with "after 1/1/2026". The server (validate-custom-field-value.ts:179) uses the same `new Date(min)`. | boundary −1 day in W; contradictory message in E | date-only string parsed as UTC; `toLocaleDateString` in browser locale | Low-Med |
| F-10 | language-dialog.tsx:126,132 | open the locale dialog | W | "Mar 14, 2025" | "Mar 13, 2025" / "3/13/25" (LA) | −1 day (cosmetic) | `new Date('2025-03-14')` = UTC midnight | Low |
| F-11 | configurable-operation-description.ts:102-103; configurable-operation-input.tsx:262-263 | op description with a datetime arg | all | local formatted date | raw "2026-03-29T00:30:00.000Z" | UTC, raw format | `instanceof Date` is never true | Low |
| F-12 | date-range-picker.tsx:84-94 | "Last month" on the 31st | all (local 31st) | previous month | 2026-03-01..2026-03-31 | wrong month | `subDays(30)` instead of `subMonths(1)` | Medium (not TZ) |
| F-13 | scheduled-tasks.tsx:148-178 | scheduled tasks list | browser ≠ server (task without timezone) | same reference zone | The cron description is in the server or task zone. The zone is only shown when the task sets one (:153). `nextExecutionAt` is in the browser zone, unlabelled. | apparent offset mismatch | mixed zones | Low |
| F-14 | job-queue.tsx:153; scheduled-tasks.tsx:162; api-keys.tsx:61 | hover the relative time | all | formatted local time | raw ISO UTC / browser-locale `toLocaleString` | inconsistent | no shared formatter | Info |

## (b) Confirmed correct

- `formatDate` (use-local-format.ts:66-71) uses Intl in the browser zone. It is correct for all zones and DST instants. `formatRelativeDate` (:73-109) gives the same result in every zone.
- These sites use `formatDate` with the default options (date only):
  - page-layout.tsx:774,787; fulfillment-details:143; profile:222; api-keys_.$id:199,213; arg-summary:103
  - payment-details:196,258; struct-form-input:177; history-entry-date.tsx; latest-orders:111; latest-customers:79
- The data-table `DateTime` cell (use-generated-columns.tsx:375 → data-display/date-time.tsx) uses `timeStyle: 'long'`, so it shows a zone abbreviation (PDT / GMT+1 / GMT+5:30 / UTC). Together with the filter-badge tooltip (:99), it is the only zone indicator.
- The DateTimePicker round trip is correct outside DST-ambiguous hours. DateTimeInput's Date→ISO conversion is correct. The filter parse/build round trip is exact.
- The Insights default range (index.tsx:84-87) is correct. The DateRangePicker conversion (date-range-picker.tsx:24-37, date-fns parse/format in local zone) has no UTC slip.
- These presets are correct: today, yesterday, last 7/30 days, this week (Monday start), month to date, this month. DST days give 23 or 25 hours.
- The list widgets send local-day instants to list filters and are correct: latest-orders:72-78, top-products:57-63, latest-customers:27-33.
- The client-side previous-period maths in orders-summary is DST-correct.
- These handle pure instants and are correct: use-job-queue-polling:209, saved-view stamps, view sorting.
- default-relation-input:529-530 gives the local day, in the browser locale.
- The UI DatePicker (date-only) is correct but unused.
- A grep of `src` finds no `slice(0,10)`, `split('T')`, `getTimezoneOffset` or `setUTC*`.
- There is no channel, server or user timezone setting. `FormatBridge` (format-bridge.tsx:22) doesn't pass `timeZone`, and `useLocalFormat` has no zone parameter.

## (c) Minimal fixes

1. MetricsService: take the client instants as given and bucket in a client-supplied IANA zone (`AT TIME ZONE` / `TZDate`). Return `YYYY-MM-DD` labels and render them as date-only.
2. Datetime filter: make it a date-only UX. "On day" becomes `between [startOfDay, endOfDay]`, and the end of a `between` defaults to `endOfDay`.
3. DateTimePicker:
   - show the zone
   - keep seconds
   - warn on non-existent times
   - skip `setHours` when the day is unchanged
4. End-boundary fields (promotion `endsAt`) default to the end of the day.
5. F-09: format the message with `formatDate` and the dashboard locale, and define what date-only min/max values mean.
6. F-10: use `new Date(2025, 2, 14)`.
7. F-11: format ISO-string datetime args.
8. F-12: use `subMonths`.
9. F-13/F-14: always show the schedule's effective zone, and format the tooltips.
10. Longer term: an optional display-timezone setting. Wire it through `FormatBridge` → `FormatProvider` `timeZone`, `useLocalFormat` and the pickers (`TZDate`).
