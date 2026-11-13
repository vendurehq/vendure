/**
 * OSS-1007 timezone spike harness. NOT for merge.
 *
 * Run with different browser zones, e.g.
 *   TZ=America/Los_Angeles bunx vitest run --project dashboard src/lib/__tz-spike__/tz-spike.spec.ts
 *
 * Real exported functions are imported where possible. Logic that lives inside
 * components / non-exported helpers is reproduced VERBATIM with a source citation.
 * Server-side (DashboardPlugin MetricsService) logic is evaluated in a server zone
 * of UTC using @date-fns/tz TZDate, independent of the process TZ (= browser TZ).
 */
import { TZDate } from '@date-fns/tz';
import fs from 'node:fs';
import {
    addDays,
    differenceInCalendarDays,
    differenceInDays,
    endOfDay,
    endOfMonth,
    endOfWeek,
    format,
    parse,
    startOfDay,
    startOfMonth,
    startOfWeek,
    subDays,
} from 'date-fns';
import { afterAll, describe, expect, it, vi } from 'vitest';

import {
    buildDateTimeFilter,
    parseDateTimeFilter,
} from '@/vdb/components/data-table/filters/data-table-datetime-filter.js';
import { formatScalarArgValue } from '@/vdb/components/shared/configurable-operation-description.js';
import { createFormSchemaFromFields } from '@/vdb/framework/form-engine/form-schema-tools.js';

const TZ = process.env.TZ ?? '(unset)';
const lines: string[] = [];
function log(id: string, label: string, value: unknown) {
    lines.push(`[${TZ}] ${id} | ${label} | ${typeof value === 'string' ? value : JSON.stringify(value)}`);
}
afterAll(() => {
    const out = '===== TZ SPIKE RESULTS (' + TZ + ', offset at 2026-01-01=' + new Date(2026, 0, 1).getTimezoneOffset() + ' / 2026-07-01=' + new Date(2026, 6, 1).getTimezoneOffset() + ') =====\n' + lines.join('\n') + '\n';
    fs.mkdirSync('/tmp/oss1007/dashboard', { recursive: true });
    fs.writeFileSync(`/tmp/oss1007/dashboard/results-${TZ.replace(/\//g, '_')}.txt`, out);
});

const LOCALE = 'en-US';

// use-local-format.ts:66-71 (verbatim)
const formatDate = (value: string | Date, options?: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(LOCALE, options).format(new Date(value));

// use-local-format.ts:73-109 (verbatim, trimmed to the branches)
function formatRelativeDate(value: string | Date, now: Date) {
    const date = new Date(value);
    const diffSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
    const rtf = new Intl.RelativeTimeFormat(LOCALE);
    if (diffSeconds < 60) return rtf.format(diffSeconds * -1, 'seconds');
    if (diffSeconds < 3600) return rtf.format(Math.floor((diffSeconds / 60) * -1), 'minutes');
    if (diffSeconds < 86400) return rtf.format(Math.floor((diffSeconds / 3600) * -1), 'hours');
    if (diffSeconds < 2592000) return rtf.format(Math.floor((diffSeconds / 86400) * -1), 'days');
    return 'months+';
}

// @vendure-io/ui date-time-picker.tsx:47-69 (verbatim; `selected` = parseInstant(value))
function pickerTimeValue(value: string | undefined) {
    const selected = value ? new Date(value) : undefined;
    return selected
        ? `${String(selected.getHours()).padStart(2, '0')}:${String(selected.getMinutes()).padStart(2, '0')}`
        : '';
}
function pickerCommitDate(value: string | undefined, date: Date) {
    const selected = value ? new Date(value) : undefined;
    const next = new Date(date);
    next.setHours(selected?.getHours() ?? 0, selected?.getMinutes() ?? 0, 0, 0);
    return next.toISOString();
}
function pickerCommitTime(value: string | undefined, time: string) {
    const selected = value ? new Date(value) : undefined;
    const [h, m] = time.split(':').map(Number);
    const next = selected ? new Date(selected) : new Date();
    next.setHours(h, m, 0, 0);
    return next.toISOString();
}
// react-day-picker hands onSelect a local-midnight Date for the clicked cell
const calendarCell = (y: number, m: number, d: number) => new Date(y, m - 1, d);

// date-range-picker.tsx:24-37 (verbatim)
const toCalendarString = (date: Date) => format(date, 'yyyy-MM-dd');
const fromCalendarString = (value: string, boundary: 'start' | 'end') => {
    const date = parse(value, 'yyyy-MM-dd', new Date());
    return boundary === 'start' ? startOfDay(date) : endOfDay(date);
};

// packages/dashboard/plugin/service/metrics.service.ts:44-134 with server TZ = UTC
// (startOfDay/endOfDay/addDays/format run in the server process zone)
function serverMetrics(startISO: string, endISO: string, serverTz = 'UTC') {
    const s = startOfDay(new TZDate(new Date(startISO), serverTz));
    const e = endOfDay(new TZDate(new Date(endISO), serverTz));
    const nrOfDays = differenceInCalendarDays(e, s) + 1;
    const buckets: Array<{ dateKey: string; label: string }> = [];
    for (let i = 0; i < nrOfDays; i++) {
        const cur = addDays(s, i);
        // metrics-strategies.ts:36 label = data.date.toISOString()
        buckets.push({ dateKey: format(cur, 'yyyy-MM-dd'), label: new Date(cur.getTime()).toISOString() });
    }
    return {
        queriedFrom: new Date(s.getTime()).toISOString(),
        queriedTo: new Date(e.getTime()).toISOString(),
        buckets,
    };
}

const SERVER_VALUES = [
    '2026-03-29T00:30:00.000Z',
    '2026-03-29T01:00:00.000Z', // Vienna spring-forward instant
    '2026-10-25T01:00:00.000Z', // Vienna fall-back instant
    '2026-03-08T10:00:00.000Z', // LA spring-forward instant
    '2026-07-15T23:30:00.000Z',
];

describe('D: display', () => {
    it('D1 formatDate variants used across the app', () => {
        for (const v of SERVER_VALUES) {
            log('D1', `${v} formatDate() default [page-layout:774, fulfillment:143, profile:222, api-keys_.$id:213, arg-summary:103]`, formatDate(v));
            log('D1', `${v} {dateStyle short,timeStyle short} [payment-details:196, struct-form-input:177]`, formatDate(v, { dateStyle: 'short', timeStyle: 'short' }));
            log('D1', `${v} history-entry-date full`, formatDate(v, { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }));
            log('D1', `${v} DateTime cell (date-time.tsx) line1 {} / line2 timeStyle long`, `${formatDate(v, {})} / ${formatDate(v, { timeStyle: 'long' })}`);
        }
    });
    it('D2 formatRelativeDate is instant-based (TZ-independent)', () => {
        const now = new Date('2026-03-29T08:00:00.000Z');
        log('D2', 'order 2026-03-28T23:00Z, now 2026-03-29T08:00Z', formatRelativeDate('2026-03-28T23:00:00.000Z', now));
        log('D2', 'order 2026-03-27T09:00Z (47h ago)', formatRelativeDate('2026-03-27T09:00:00.000Z', now));
    });
    it('D3 language-dialog sample date new Date("2025-03-14") (language-dialog.tsx:126,132)', () => {
        log('D3', 'expected "Mar 14, 2025" / "3/14/25"', `${formatDate(new Date('2025-03-14'), { dateStyle: 'medium' })} / ${formatDate(new Date('2025-03-14'), { dateStyle: 'short' })}`);
    });
    it('D4 configurable-operation description datetime arg (configurable-operation-description.ts:102)', () => {
        const v = '2026-03-29T00:30:00.000Z';
        const out = formatScalarArgValue({ type: 'datetime' } as any, v);
        log('D4', `formatScalarArgValue(datetime, "${v}") (string, never a Date)`, out);
        expect(out).toBe(v);
    });
    it('D5 api-keys.tsx:61 title uses toLocaleString() (browser locale, not dashboard locale)', () => {
        log('D5', 'new Date(v).toLocaleString()', new Date('2026-03-29T00:30:00.000Z').toLocaleString());
    });
});

describe('I: DateTimePicker (DateTimeInput) input', () => {
    it('I1 pick a day in the calendar with no prior value', () => {
        const iso = pickerCommitDate(undefined, calendarCell(2026, 3, 29));
        log('I1', 'pick 2026-03-29 (no value) -> sent', iso);
        log('I1', '  then time input shows', pickerTimeValue(iso));
    });
    it('I2 type a time on DST days', () => {
        const cases: Array<[number, number, number, string]> = [
            [2026, 3, 29, '02:30'], // Vienna gap
            [2026, 10, 25, '02:30'], // Vienna overlap
            [2026, 3, 8, '02:30'], // LA gap
            [2026, 11, 1, '01:30'], // LA overlap
        ];
        for (const [y, m, d, t] of cases) {
            const day = pickerCommitDate(undefined, calendarCell(y, m, d));
            const iso = pickerCommitTime(day, t);
            log('I2', `pick ${y}-${m}-${d} then type ${t} -> sent`, `${iso} (redisplays as ${pickerTimeValue(iso)})`);
        }
    });
    it('I3 re-picking the same calendar day on an existing value (wall-clock preserved?)', () => {
        for (const v of ['2026-10-25T01:30:00.000Z', '2026-11-01T09:30:00.000Z', '2026-03-29T00:30:00.000Z', '2026-03-29T10:15:42.123Z']) {
            const sel = new Date(v);
            const next = pickerCommitDate(v, calendarCell(sel.getFullYear(), sel.getMonth() + 1, sel.getDate()));
            log('I3', `value ${v} shown ${pickerTimeValue(v)}; re-click same day -> sent`, `${next} (delta ${(new Date(next).getTime() - sel.getTime()) / 60000} min)`);
        }
    });
    it('I4 server value round-trip: shown date/time for an existing value', () => {
        for (const v of SERVER_VALUES) {
            log('I4', `value ${v} -> trigger label / time input`, `${new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium' }).format(new Date(v))} / ${pickerTimeValue(v)}`);
        }
    });
});

describe('F: data-table datetime filter', () => {
    it('F1 "orders on 2026-03-29" via each operator (pick day, leave time 00:00)', () => {
        const d29 = new Date(pickerCommitDate(undefined, calendarCell(2026, 3, 29)));
        const d30 = new Date(pickerCommitDate(undefined, calendarCell(2026, 3, 30)));
        for (const op of ['eq', 'before', 'after']) {
            log('F1', `${op} 2026-03-29`, buildDateTimeFilter(op, d29).filter);
        }
        log('F1', 'between 2026-03-29..2026-03-29', buildDateTimeFilter('between', undefined, d29, d29).filter);
        log('F1', 'between 2026-03-29..2026-03-30', buildDateTimeFilter('between', undefined, d29, d30).filter);
    });
    it('F2 saved/URL filter round-trip (parseDateTimeFilter -> build)', () => {
        const stored = { between: { start: '2026-03-29T00:00:00.000Z', end: '2026-03-29T23:59:00.000Z' } };
        const p = parseDateTimeFilter(stored);
        const rebuilt = buildDateTimeFilter(p.operator, p.value, p.startDate, p.endDate).filter;
        log('F2', 'stored UTC-day filter re-parsed and rebuilt', rebuilt);
        expect(rebuilt).toEqual(stored);
        log('F2', 'badge shows (data-table-filter-badge.tsx:100)', `${formatDate(stored.between.start, { dateStyle: 'short' })} .. ${formatDate(stored.between.end, { dateStyle: 'short' })}`);
    });
});

describe('W: Insights date range + widgets', () => {
    const nows = ['2026-03-29T00:30:00.000Z', '2026-03-29T01:00:00.000Z', '2026-03-08T10:00:00.000Z', '2026-03-31T12:00:00.000Z'];
    it('W1 default range (index.tsx:84-87) and presets (date-range-picker.tsx:39-95)', () => {
        for (const now of nows) {
            vi.useFakeTimers();
            vi.setSystemTime(new Date(now));
            const def = { from: startOfMonth(new Date()), to: endOfDay(new Date()) };
            log('W1', `now=${now} default range sent`, `${def.from.toISOString()} .. ${def.to.toISOString()}`);
            const presets: Record<string, () => { from: string; to: string }> = {
                today: () => ({ from: toCalendarString(new Date()), to: toCalendarString(new Date()) }),
                'this-week': () => ({
                    from: toCalendarString(startOfWeek(new Date(), { weekStartsOn: 1 })),
                    to: toCalendarString(endOfWeek(new Date(), { weekStartsOn: 1 })),
                }),
                'last-month': () => {
                    const lastMonth = subDays(new Date(), 30);
                    return { from: toCalendarString(startOfMonth(lastMonth)), to: toCalendarString(endOfMonth(lastMonth)) };
                },
            };
            for (const [id, fn] of Object.entries(presets)) {
                const v = fn();
                const r = { from: fromCalendarString(v.from, 'start'), to: fromCalendarString(v.to, 'end') };
                log('W1', `now=${now} preset ${id} ${v.from}..${v.to} sent`, `${r.from.toISOString()} .. ${r.to.toISOString()} (${(r.to.getTime() - r.from.getTime() + 1) / 3600000}h)`);
            }
            vi.useRealTimers();
        }
    });
    it('W2 metrics widget: user picks 2026-03-29..2026-03-29; server (UTC) re-normalises + labels; client formats labels', () => {
        for (const [a, b] of [['2026-03-29', '2026-03-29'], ['2026-03-01', '2026-03-31'], ['2026-10-25', '2026-10-25']]) {
            const r = { from: fromCalendarString(a, 'start'), to: fromCalendarString(b, 'end') };
            const sent = { startDate: r.from.toISOString(), endDate: r.to.toISOString() };
            const srv = serverMetrics(sent.startDate, sent.endDate);
            const shown = srv.buckets.map(bk => `${bk.dateKey}->"${formatDate(bk.label, { month: 'short', day: 'numeric' })}"`);
            log('W2', `pick ${a}..${b}: sent`, sent);
            log('W2', `  server queries orderPlacedAt`, `${srv.queriedFrom} .. ${srv.queriedTo} (${srv.buckets.length} buckets)`);
            log('W2', `  buckets (UTC dateKey -> x-axis label shown)`, shown.length > 6 ? [...shown.slice(0, 2), '...', ...shown.slice(-2)].join(', ') : shown.join(', '));
        }
    });
    it('W3 orders-summary previous period (orders-summary/index.tsx:47-58)', () => {
        for (const [a, b] of [['2026-03-29', '2026-03-29'], ['2026-03-30', '2026-03-30'], ['2026-03-23', '2026-03-29'], ['2026-04-01', '2026-04-30']]) {
            const from = fromCalendarString(a, 'start');
            const to = fromCalendarString(b, 'end');
            const rangeLength = differenceInDays(to, from) + 1;
            const ps = subDays(from, rangeLength);
            const pe = subDays(to, rangeLength);
            const srvCur = serverMetrics(from.toISOString(), to.toISOString());
            const srvPrev = serverMetrics(ps.toISOString(), pe.toISOString());
            log('W3', `range ${a}..${b} rangeLength=${rangeLength}`, `current sent ${from.toISOString()}..${to.toISOString()} | previous sent ${ps.toISOString()}..${pe.toISOString()}`);
            log('W3', `  server(UTC) current/previous days`, `${srvCur.buckets.map(x => x.dateKey).join(',')} | ${srvPrev.buckets.map(x => x.dateKey).join(',')}`);
        }
    });
});

describe('V: custom field datetime min/max validation message (form-schema-tools.ts:87-127)', () => {
    it('V1 datetimeMin "2026-01-01"', () => {
        const schema = createFormSchemaFromFields(
            [{ name: 'customFields', type: 'CustomFields', nullable: true, list: false, isPaginatedList: false, isScalar: false } as any],
            [{ name: 'validFrom', type: 'datetime', list: false, nullable: true, readonly: false, datetimeMin: '2026-01-01', datetimeMax: '2026-12-31T23:59:59Z' } as any],
        );
        for (const v of ['2025-12-31T23:30:00.000Z', '2026-01-01T00:00:00.000Z', pickerCommitDate(undefined, calendarCell(2026, 1, 1))]) {
            const res = schema.safeParse({ customFields: { validFrom: v } });
            log('V1', `value ${v} (shown as ${formatDate(v, { dateStyle: 'medium', timeStyle: 'short' })})`, res.success ? 'valid' : res.error.issues.map(i => i.message).join('; '));
        }
        log('V1', 'min date as shown in message: new Date("2026-01-01").toLocaleDateString()', new Date('2026-01-01').toLocaleDateString());
    });
});
