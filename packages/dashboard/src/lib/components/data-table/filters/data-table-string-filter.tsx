import { Select, SelectItem, SelectTrigger, SelectValue } from '@/vdb/components/ui/select.js';

import { Input } from '@/vdb/components/ui/input.js';
import { SelectContent } from '@/vdb/components/ui/select.js';
import { useEffect, useState } from 'react';
import { HumanReadableOperator } from '../human-readable-operator.js';

export interface DataTableStringFilterProps {
    value: Record<string, any> | undefined;
    onChange: (filter: Record<string, any>) => void;
}

export const STRING_OPERATORS = [
    'eq',
    'notEq',
    'contains',
    'notContains',
    'in',
    'notIn',
    'regex',
    'isNull',
] as const;

export function DataTableStringFilter({
    value: incomingValue,
    onChange,
}: Readonly<DataTableStringFilterProps>) {
    const initialOperator = incomingValue ? Object.keys(incomingValue)[0] : 'contains';
    const initialValue = incomingValue ? Object.values(incomingValue)[0] : '';
    const [operator, setOperator] = useState<string>(initialOperator ?? 'contains');
    const [value, setValue] = useState((initialValue as string) ?? '');

    useEffect(() => {
        if (operator === 'isNull') {
            onChange({ [operator]: true });
        } else if (operator === 'in' || operator === 'notIn') {
            // Split by comma and trim whitespace
            if (typeof value === 'string') {
                const values = value
                    .split(',')
                    .map(v => v.trim())
                    .filter(v => v);
                onChange({ [operator]: values });
            } else {
                onChange({ [operator]: [] });
            }
        } else {
            onChange({ [operator]: value });
        }
    }, [operator, value]);

    return (
        <div className="flex flex-col md:flex-row gap-2">
            <Select
                items={Object.fromEntries(STRING_OPERATORS.map(op => [op, <HumanReadableOperator key={op} operator={op} />]))}
                value={operator}
                onValueChange={value => { if (value != null) setOperator(value); }}
            >
                <SelectTrigger>
                    <SelectValue placeholder="Select operator" />
                </SelectTrigger>
                <SelectContent>
                    {STRING_OPERATORS.map(op => (
                        <SelectItem key={op} value={op}>
                            <HumanReadableOperator operator={op} />
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            {operator !== 'isNull' && (
                <Input
                    placeholder={
                        operator === 'in' || operator === 'notIn'
                            ? 'Enter comma-separated values...'
                            : 'Enter filter value...'
                    }
                    value={value}
                    onChange={e => setValue(e.target.value)}
                />
            )}
        </div>
    );
}
