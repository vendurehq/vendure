import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/vdb/components/ui/select.js';
import { useLingui } from '@lingui/react/macro';
import { useEffect, useState } from 'react';
import { HumanReadableOperator } from '../human-readable-operator.js';

export interface DataTableEnumFilterProps {
    value: Record<string, any> | undefined;
    options: string[];
    onChange: (filter: Record<string, any>) => void;
}

export const ENUM_OPERATORS = ['eq', 'notEq', 'isNull'] as const;

export function DataTableEnumFilter({ value: incomingValue, options, onChange }: Readonly<DataTableEnumFilterProps>) {
    const { t } = useLingui();
    const operatorLabels: Record<string, string> = {
        eq: t`is equal to`,
        notEq: t`is not equal to`,
        isNull: t`is null`,
    };
    const initialOperator = incomingValue ? Object.keys(incomingValue)[0] : 'eq';
    // `isNull` stores a boolean, so only carry over a string value; otherwise fall
    // back to the first option so switching to eq/notEq never emits `{ eq: true }`.
    const rawInitialValue = incomingValue ? Object.values(incomingValue)[0] : undefined;
    const initialValue = typeof rawInitialValue === 'string' ? rawInitialValue : (options[0] ?? '');
    const [operator, setOperator] = useState<string>(initialOperator ?? 'eq');
    const [value, setValue] = useState<string>(initialValue);

    useEffect(() => {
        if (operator === 'isNull') {
            onChange({ [operator]: true });
        } else {
            onChange({ [operator]: value });
        }
    }, [operator, value]);

    return (
        <div className="flex flex-col md:flex-row gap-2">
            <Select
                items={operatorLabels}
                value={operator}
                onValueChange={v => {
                    if (v != null) {
                        setOperator(v);
                        // Re-establish a valid enum value when leaving `isNull`.
                        if (v !== 'isNull' && !options.includes(value)) {
                            setValue(options[0] ?? '');
                        }
                    }
                }}
            >
                <SelectTrigger>
                    <SelectValue placeholder={t`Select operator`} />
                </SelectTrigger>
                <SelectContent>
                    {ENUM_OPERATORS.map(op => (
                        <SelectItem key={op} value={op}>
                            <HumanReadableOperator operator={op} />
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            {operator !== 'isNull' && (
                <Select
                    items={Object.fromEntries(options.map(o => [o, o]))}
                    value={value}
                    onValueChange={v => {
                        if (v != null) setValue(v);
                    }}
                >
                    <SelectTrigger>
                        <SelectValue placeholder={t`Select value`} />
                    </SelectTrigger>
                    <SelectContent>
                        {options.map(o => (
                            <SelectItem key={o} value={o}>
                                {o}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            )}
        </div>
    );
}
