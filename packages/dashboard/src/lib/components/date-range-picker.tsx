import { DateRangePicker as UiDateRangePicker } from '@vendure-io/ui/components/molecules/date-range-picker';
import { type DateRangePreset, type DateRangeValue } from '@/vdb/components/ui/date-picker.js';
import { DefinedDateRange } from '@/vdb/framework/dashboard-widget/widget-filters-context.js';
import { cn } from '@/vdb/lib/utils.js';
import { Trans, useLingui } from '@lingui/react/macro';
import {
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

interface DateRangePickerProps {
    className?: string;
    dateRange: DefinedDateRange;
    onDateRangeChange: (range: DefinedDateRange) => void;
}

const CALENDAR_DATE_FORMAT = 'yyyy-MM-dd';

// The v2 picker is date-only and string-valued (`YYYY-MM-DD`). The dashboard
// contract is instants where `from` means start-of-day and `to` means
// end-of-day (analytics query boundaries). Convert at this seam using the local
// zone — the same assumption react-day-picker and the previous Calendar used.
function toCalendarString(date: Date): string {
    return format(date, CALENDAR_DATE_FORMAT);
}

function fromCalendarString(value: string, boundary: 'start' | 'end'): Date {
    const date = parse(value, CALENDAR_DATE_FORMAT, new Date());
    return boundary === 'start' ? startOfDay(date) : endOfDay(date);
}

const presets: readonly DateRangePreset[] = [
    {
        id: 'today',
        label: <Trans context="date-range">Today</Trans>,
        value: () => ({ from: toCalendarString(new Date()), to: toCalendarString(new Date()) }),
    },
    {
        id: 'yesterday',
        label: <Trans context="date-range">Yesterday</Trans>,
        value: () => {
            const day = subDays(new Date(), 1);
            return { from: toCalendarString(day), to: toCalendarString(day) };
        },
    },
    {
        id: 'last-7-days',
        label: <Trans context="date-range">Last 7 days</Trans>,
        value: () => ({ from: toCalendarString(subDays(new Date(), 6)), to: toCalendarString(new Date()) }),
    },
    {
        id: 'this-week',
        label: <Trans context="date-range">This week</Trans>,
        value: () => ({
            from: toCalendarString(startOfWeek(new Date(), { weekStartsOn: 1 })),
            to: toCalendarString(endOfWeek(new Date(), { weekStartsOn: 1 })),
        }),
    },
    {
        id: 'last-30-days',
        label: <Trans context="date-range">Last 30 days</Trans>,
        value: () => ({ from: toCalendarString(subDays(new Date(), 29)), to: toCalendarString(new Date()) }),
    },
    {
        id: 'month-to-date',
        label: <Trans context="date-range">Month to date</Trans>,
        value: () => ({ from: toCalendarString(startOfMonth(new Date())), to: toCalendarString(new Date()) }),
    },
    {
        id: 'this-month',
        label: <Trans context="date-range">This month</Trans>,
        value: () => ({
            from: toCalendarString(startOfMonth(new Date())),
            to: toCalendarString(endOfMonth(new Date())),
        }),
    },
    {
        id: 'last-month',
        label: <Trans context="date-range">Last month</Trans>,
        value: () => {
            const lastMonth = subDays(new Date(), 30);
            return {
                from: toCalendarString(startOfMonth(lastMonth)),
                to: toCalendarString(endOfMonth(lastMonth)),
            };
        },
    },
];

export function DateRangePicker({ className, dateRange, onDateRangeChange }: DateRangePickerProps) {
    const { t } = useLingui();

    const value: DateRangeValue = {
        from: toCalendarString(dateRange.from),
        to: toCalendarString(dateRange.to),
    };

    const handleValueChange = (next: DateRangeValue | undefined) => {
        if (!next?.from) {
            return;
        }
        onDateRangeChange({
            from: fromCalendarString(next.from, 'start'),
            to: fromCalendarString(next.to ?? next.from, 'end'),
        });
    };

    return (
        <UiDateRangePicker
            className={cn('w-[280px]', className)}
            value={value}
            onValueChange={handleValueChange}
            presets={presets}
            clearable={false}
            placeholder={t`Select date range`}
            calendarProps={{ numberOfMonths: 2, showOutsideDays: false }}
        />
    );
}
