import { useDayPickerLocale } from '@/vdb/components/data-input/index.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Calendar } from '@/vdb/components/ui/calendar.js';
import { Popover, PopoverContent, PopoverTrigger } from '@/vdb/components/ui/popover.js';
import { DefinedDateRange } from '@/vdb/framework/dashboard-widget/widget-filters-context.js';
import { useLocalFormat } from '@/vdb/hooks/use-local-format.js';
import { cn } from '@/vdb/lib/utils.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { endOfDay, endOfMonth, endOfWeek, startOfDay, startOfMonth, startOfWeek, subDays } from 'date-fns';
import { CalendarIcon } from 'lucide-react';
import * as React from 'react';
import { DateRange } from 'react-day-picker';

interface DateRangePickerProps {
    className?: string;
    dateRange: DefinedDateRange;
    onDateRangeChange: (range: DefinedDateRange) => void;
}

const presets = [
    {
        id: 'today',
        label: <Trans context="date-range">Today</Trans>,
        getValue: () => ({
            from: startOfDay(new Date()),
            to: endOfDay(new Date()),
        }),
    },
    {
        id: 'yesterday',
        label: <Trans context="date-range">Yesterday</Trans>,
        getValue: () => ({
            from: startOfDay(subDays(new Date(), 1)),
            to: endOfDay(subDays(new Date(), 1)),
        }),
    },
    {
        id: 'last-7-days',
        label: <Trans context="date-range">Last 7 days</Trans>,
        getValue: () => ({
            from: startOfDay(subDays(new Date(), 6)),
            to: endOfDay(new Date()),
        }),
    },
    {
        id: 'this-week',
        label: <Trans context="date-range">This week</Trans>,
        getValue: () => ({
            from: startOfWeek(new Date(), { weekStartsOn: 1 }),
            to: endOfWeek(new Date(), { weekStartsOn: 1 }),
        }),
    },
    {
        id: 'last-30-days',
        label: <Trans context="date-range">Last 30 days</Trans>,
        getValue: () => ({
            from: startOfDay(subDays(new Date(), 29)),
            to: endOfDay(new Date()),
        }),
    },
    {
        id: 'month-to-date',
        label: <Trans context="date-range">Month to date</Trans>,
        getValue: () => ({
            from: startOfMonth(new Date()),
            to: endOfDay(new Date()),
        }),
    },
    {
        id: 'this-month',
        label: <Trans context="date-range">This month</Trans>,
        getValue: () => ({
            from: startOfMonth(new Date()),
            to: endOfMonth(new Date()),
        }),
    },
    {
        id: 'last-month',
        label: <Trans context="date-range">Last month</Trans>,
        getValue: () => ({
            from: startOfMonth(subDays(new Date(), 30)),
            to: endOfMonth(subDays(new Date(), 30)),
        }),
    },
];

export function DateRangePicker({ className, dateRange, onDateRangeChange }: DateRangePickerProps) {
    const [open, setOpen] = React.useState(false);
    const { t } = useLingui();
    const { formatDate } = useLocalFormat();
    const locale = useDayPickerLocale();
    // Internal state uses react-day-picker's DateRange type for Calendar compatibility
    const [selectedRange, setSelectedRange] = React.useState<DateRange>({
        from: dateRange.from,
        to: dateRange.to,
    });

    React.useEffect(() => {
        setSelectedRange({
            from: dateRange.from,
            to: dateRange.to,
        });
    }, [dateRange]);

    const handleSelect = (range: DateRange | undefined) => {
        if (range?.from) {
            // If no end date is selected, use the from date as the end date
            const to = range.to || range.from;
            const finalRange: DefinedDateRange = {
                from: range.from,
                to: to,
            };
            setSelectedRange({ from: range.from, to });
            onDateRangeChange(finalRange);
        }
    };

    const handlePresetClick = (preset: (typeof presets)[number]) => {
        const range = preset.getValue();
        handleSelect(range);
        setOpen(false);
    };

    const formatDateRange = () => {
        if (!selectedRange.from) {
            return t`Select date range`;
        }
        if (!selectedRange.to || selectedRange.from === selectedRange.to) {
            return formatDate(selectedRange.from, { dateStyle: 'medium' });
        }
        return `${formatDate(selectedRange.from, { dateStyle: 'medium' })} - ${formatDate(selectedRange.to, { dateStyle: 'medium' })}`;
    };

    const isPresetActive = (preset: (typeof presets)[number]) => {
        if (!selectedRange.from || !selectedRange.to) return false;
        const presetRange = preset.getValue();
        return (
            selectedRange.from.getTime() === presetRange.from.getTime() &&
            selectedRange.to.getTime() === presetRange.to.getTime()
        );
    };

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger render={<Button
                    variant="outline"
                    className={cn('w-[280px] justify-start text-left font-normal', className)}
                />}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {formatDateRange()}
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
                <div className="flex">
                    <div className="border-r p-2 space-y-0.5 min-w-0 w-32">
                        {presets.map(preset => (
                            <Button
                                key={preset.id}
                                variant={isPresetActive(preset) ? 'default' : 'ghost'}
                                size="sm"
                                className="w-full justify-start font-normal text-xs h-7 px-2"
                                onClick={() => handlePresetClick(preset)}
                            >
                                {preset.label}
                            </Button>
                        ))}
                    </div>
                    <div className="p-3">
                        <Calendar
                            mode="range"
                            defaultMonth={selectedRange?.from}
                            selected={selectedRange}
                            onSelect={handleSelect}
                            numberOfMonths={2}
                            showOutsideDays={false}
                            locale={locale}
                        />
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    );
}
