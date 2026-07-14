import { DateTimeInput } from '@/vdb/components/data-input/datetime-input.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/vdb/components/ui/select.js';
import { useEffect, useState } from 'react';
import { HumanReadableOperator } from '../human-readable-operator.js';

export interface DataTableDateTimeFilterProps {
    value: Record<string, any> | undefined;
    onChange: (filter: Record<string, any>) => void;
}

export const DATETIME_OPERATORS = ['eq', 'before', 'after', 'between', 'isNull'] as const;

export interface DateTimeFilterResult {
    filter: Record<string, any>;
    error?: string;
}

export interface ParsedDateTimeFilter {
    operator: string;
    value?: Date;
    startDate?: Date;
    endDate?: Date;
}

export function parseDateTimeFilter(incomingValue: Record<string, any> | undefined): ParsedDateTimeFilter {
    if (!incomingValue || Object.keys(incomingValue).length === 0) {
        return { operator: 'eq' };
    }

    const operator = Object.keys(incomingValue)[0];
    const value = Object.values(incomingValue)[0];

    if (operator === 'isNull') {
        return { operator };
    }

    if (operator === 'between' && typeof value === 'object' && value !== null) {
        return {
            operator,
            startDate: value.start ? new Date(value.start) : undefined,
            endDate: value.end ? new Date(value.end) : undefined,
        };
    }

    // For eq, before, after operators
    return {
        operator,
        value: typeof value === 'string' ? new Date(value) : undefined,
    };
}

export function buildDateTimeFilter(
    operator: string,
    value?: Date,
    startDate?: Date,
    endDate?: Date,
): DateTimeFilterResult {
    if (operator === 'isNull') {
        return { filter: { [operator]: true } };
    }

    if (operator === 'between') {
        if (!startDate && !endDate) {
            return { filter: {} };
        }
        if (!startDate || !endDate) {
            return { filter: {}, error: 'Please enter both start and end dates' };
        }
        if (startDate > endDate) {
            return { filter: {}, error: 'Start date must be before end date' };
        }
        return {
            filter: { [operator]: { start: startDate.toISOString(), end: endDate.toISOString() } },
        };
    } else {
        if (!value) {
            return { filter: {} };
        }
        return { filter: { [operator]: value.toISOString() } };
    }
}

export function DataTableDateTimeFilter({
    value: incomingValue,
    onChange,
}: Readonly<DataTableDateTimeFilterProps>) {
    const parsed = parseDateTimeFilter(incomingValue);
    const [operator, setOperator] = useState<string>(parsed.operator);
    const [value, setValue] = useState<Date | undefined>(parsed.value);
    const [startDate, setStartDate] = useState<Date | undefined>(parsed.startDate);
    const [endDate, setEndDate] = useState<Date | undefined>(parsed.endDate);
    const [error, setError] = useState<string>('');


    useEffect(() => {
        const result = buildDateTimeFilter(operator, value, startDate, endDate);
        onChange(result.filter);
        setError(result.error ?? '');
    }, [operator, value, startDate, endDate]);

    const parseToDate = (input: unknown): Date | undefined => {
        if (input instanceof Date) {
            return input;
        }
        if (typeof input === 'string' && input !== '') {
            return new Date(input);
        }
        return;
    };

    const dashboardComponentProps = {
        name: 'date',
        onBlur: () => {
            /* */
        },
        ref: () => null,
    };

    return (
        <div className="flex flex-col gap-2">
            <div className="flex flex-col md:flex-row gap-2">
                <Select
                    items={Object.fromEntries(DATETIME_OPERATORS.map(op => [op, <HumanReadableOperator key={op} operator={op} />]))}
                    value={operator}
                    onValueChange={value => { if (value != null) setOperator(value); }}
                >
                    <SelectTrigger>
                        <SelectValue placeholder="Select operator" />
                    </SelectTrigger>
                    <SelectContent>
                        {DATETIME_OPERATORS.map(op => (
                            <SelectItem key={op} value={op}>
                                <HumanReadableOperator operator={op} />
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                {operator !== 'isNull' &&
                    (operator === 'between' ? (
                        <div className="space-y-2">
                            <DateTimeInput
                                {...dashboardComponentProps}
                                value={startDate}
                                onChange={val => setStartDate(parseToDate(val))}
                            />
                            <DateTimeInput
                                {...dashboardComponentProps}
                                value={endDate}
                                onChange={val => setEndDate(parseToDate(val))}
                            />
                        </div>
                    ) : (
                        <DateTimeInput
                            {...dashboardComponentProps}
                            value={value}
                            onChange={val => setValue(parseToDate(val))}
                        />
                    ))}
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
    );
}
