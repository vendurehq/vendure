import { format } from 'date-fns';
import * as React from 'react';
import { useEffect, useState } from 'react';

import { Button } from '@/vdb/components/ui/button.js';
import { Calendar } from '@/vdb/components/ui/calendar.js';
import { Popover, PopoverContent, PopoverTrigger } from '@/vdb/components/ui/popover.js';
import { ScrollArea, ScrollBar } from '@/vdb/components/ui/scroll-area.js';
import { DashboardFormComponentProps } from '@/vdb/framework/form-engine/form-engine-types.js';
import { isFieldDisabled } from '@/vdb/framework/form-engine/utils.js';
import { useDisplayLocale } from '@/vdb/hooks/use-display-locale.js';
import { cn } from '@/vdb/lib/utils.js';
import type { Locale } from 'date-fns/locale';
import { Trans } from '@lingui/react/macro';
import { CalendarClock, Clock, X } from 'lucide-react';

/**
 * @description
 * Returns a `Locale` object that can be passed to the react-day-picker
 * `locale` prop.
 */
export function useDayPickerLocale() {
    const { bcp47Tag } = useDisplayLocale();
    const [calendarLocale, setCalendarLocale] = useState<Locale | undefined>(undefined);
    useEffect(() => {
        import('react-day-picker/locale').then(mod => {
            setCalendarLocale(bcpTagToDatePickerLocale(bcp47Tag, mod));
        });
    }, [bcp47Tag]);
    return calendarLocale;
}

/**
 * @description
 * A component for selecting a date and time.
 *
 * @docsCategory form-components
 * @docsPage DateTimeInput
 */
export function DateTimeInput({ value, onChange, fieldDef, disabled }: Readonly<DashboardFormComponentProps>) {
    const readOnly = isFieldDisabled(disabled, fieldDef);
    const locale = useDayPickerLocale();
    const date = value && value instanceof Date ? value.toISOString() : (value ?? '');
    const [isOpen, setIsOpen] = React.useState(false);

    const hours = Array.from({ length: 12 }, (_, i) => i + 1);
    const handleDateSelect = (selectedDate: Date | undefined) => {
        if (selectedDate) {
            onChange(selectedDate.toISOString());
        }
    };

    const handleSetToNow = () => {
        onChange(new Date().toISOString());
        setIsOpen(false);
    };

    const handleTimeChange = (type: 'hour' | 'minute' | 'ampm', value: string) => {
        if (date) {
            const newDate = new Date(date);
            if (type === 'hour') {
                newDate.setHours((Number.parseInt(value) % 12) + (newDate.getHours() >= 12 ? 12 : 0));
            } else if (type === 'minute') {
                newDate.setMinutes(Number.parseInt(value));
            } else if (type === 'ampm') {
                const currentHours = newDate.getHours();
                newDate.setHours(value === 'PM' ? currentHours + 12 : currentHours - 12);
            }
            onChange(newDate.toISOString());
        }
    };

    return (
        <Popover open={isOpen} onOpenChange={readOnly ? undefined : setIsOpen}>
            <PopoverTrigger render={<div className="flex items-center" />}>
                    <Button
                        variant="outline"
                        disabled={readOnly}
                        className={cn(
                            'flex-1 min-w-0 justify-start text-left font-normal',
                            date ? 'rounded-r-none' : 'text-muted-foreground',
                        )}
                    >
                        <CalendarClock className="mr-2 h-4 w-4 shrink-0" />
                        <span className="truncate">{date ? format(date, 'MM/dd/yyyy hh:mm aa') : 'MM/DD/YYYY hh:mm aa'}</span>
                    </Button>
                    {date ? (
                        <Button
                            variant="outline"
                            disabled={readOnly}
                            className="shrink-0 rounded-l-none border-l-0"
                            onClick={e => {
                                e.stopPropagation();
                                onChange(null);
                            }}
                        >
                            <X />
                        </Button>
                    ) : null}
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0">
                <div className="sm:flex">
                    <Calendar
                        mode="single"
                        locale={locale}
                        selected={new Date(date)}
                        onSelect={handleDateSelect}
                        initialFocus
                    />
                    <div className="flex flex-col sm:flex-row sm:h-[300px] divide-y sm:divide-y-0 sm:divide-x">
                        <ScrollArea className="w-64 sm:w-auto">
                            <div className="flex sm:flex-col p-2">
                                {[...hours].reverse().map(hour => (
                                    <Button
                                        key={hour}
                                        size="icon"
                                        variant={
                                            date && new Date(date).getHours() % 12 === hour % 12
                                                ? 'default'
                                                : 'ghost'
                                        }
                                        className="sm:w-full shrink-0 aspect-square"
                                        onClick={() => handleTimeChange('hour', hour.toString())}
                                    >
                                        {hour}
                                    </Button>
                                ))}
                            </div>
                            <ScrollBar orientation="horizontal" className="sm:hidden" />
                        </ScrollArea>
                        <ScrollArea className="w-64 sm:w-auto">
                            <div className="flex sm:flex-col p-2">
                                {Array.from({ length: 12 }, (_, i) => i * 5).map(minute => (
                                    <Button
                                        key={minute}
                                        size="icon"
                                        variant={
                                            date && new Date(date).getMinutes() === minute
                                                ? 'default'
                                                : 'ghost'
                                        }
                                        className="sm:w-full shrink-0 aspect-square"
                                        onClick={() => handleTimeChange('minute', minute.toString())}
                                    >
                                        {minute}
                                    </Button>
                                ))}
                            </div>
                            <ScrollBar orientation="horizontal" className="sm:hidden" />
                        </ScrollArea>
                        <ScrollArea className="">
                            <div className="flex sm:flex-col p-2">
                                {['AM', 'PM'].map(ampm => (
                                    <Button
                                        key={ampm}
                                        size="icon"
                                        variant={
                                            date &&
                                            ((ampm === 'AM' && new Date(date).getHours() < 12) ||
                                                (ampm === 'PM' && new Date(date).getHours() >= 12))
                                                ? 'default'
                                                : 'ghost'
                                        }
                                        className="sm:w-full shrink-0 aspect-square"
                                        onClick={() => handleTimeChange('ampm', ampm)}
                                    >
                                        {ampm}
                                    </Button>
                                ))}
                            </div>
                        </ScrollArea>
                    </div>
                    <div className="border-t p-2">
                        <Button
                            variant="outline"
                            size="sm"
                            className="w-full"
                            onClick={handleSetToNow}
                        >
                            <Clock className="mr-2 h-4 w-4" />
                            <Trans>Now</Trans>
                        </Button>
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    );
}

function bcpTagToDatePickerLocale(
    tag: string,
    module: typeof import('react-day-picker/locale'),
): Locale | undefined {
    switch (tag) {
        case 'zh-Hans':
            return module.zhCN;
        case 'zh-Hant':
            return module.zhTW;
        case 'pt-BR':
            return module.ptBR;
        default: {
            const lang = tag.split('-')[0];
            return lang ? module[lang as keyof typeof module] : undefined;
        }
    }
}
