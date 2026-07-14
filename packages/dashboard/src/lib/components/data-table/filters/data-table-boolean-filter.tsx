import { Trans } from '@lingui/react/macro';

import { Select, SelectItem, SelectTrigger, SelectValue } from '@/vdb/components/ui/select.js';

import { SelectContent } from '@/vdb/components/ui/select.js';
import { useEffect, useState } from 'react';
import { HumanReadableOperator } from '../human-readable-operator.js';

export interface DataTableBooleanFilterProps {
    value: Record<string, any> | undefined;
    onChange: (filter: Record<string, any>) => void;
}

export const BOOLEAN_OPERATORS = ['eq', 'isNull'] as const;

export function DataTableBooleanFilter({
                                           value: incomingValue,
                                           onChange,
                                       }: Readonly<DataTableBooleanFilterProps>) {
    const initialOperator = incomingValue ? (Object.keys(incomingValue)[0] ?? 'eq') : 'eq';
    const initialValue = incomingValue ? Object.values(incomingValue)[0] : true;
    const [operator, setOperator] = useState<string>(initialOperator ?? 'eq');
    const [value, setValue] = useState<boolean>((initialValue as boolean) ?? true);

    useEffect(() => {
        onChange({ [operator]: value });
    }, [operator, value]);

    return (
        <div className="flex flex-col md:flex-row gap-2">
            <Select
                items={Object.fromEntries(BOOLEAN_OPERATORS.map(op => [op, <HumanReadableOperator key={op} operator={op} />]))}
                value={operator}
                onValueChange={value => { if (value != null) setOperator(value); }}
            >
                <SelectTrigger>
                    <SelectValue placeholder="Select operator" />
                </SelectTrigger>
                <SelectContent>
                    {BOOLEAN_OPERATORS.map(op => (
                        <SelectItem key={op} value={op}>
                            <HumanReadableOperator operator={op} />
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            {operator !== 'isNull' && (
                <Select items={{ 'true': 'True', 'false': 'False' }} value={value.toString()} onValueChange={v => { if (v != null) setValue(v === 'true'); }}>
                    <SelectTrigger>
                        <SelectValue placeholder="Select value" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="true">
                            <Trans>True</Trans>
                        </SelectItem>
                        <SelectItem value="false">
                            <Trans>False</Trans>
                        </SelectItem>
                    </SelectContent>
                </Select>
            )}
        </div>
    );
}
