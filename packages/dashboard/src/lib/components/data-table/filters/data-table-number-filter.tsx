import { MoneyInput } from '@/vdb/components/data-input/money-input.js';
import { Input } from '@/vdb/components/ui/input.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/vdb/components/ui/select.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { useEffect, useState } from 'react';
import { HumanReadableOperator } from '../human-readable-operator.js';

export interface DataTableNumberFilterProps {
    mode: 'number' | 'money';
    value: Record<string, any> | undefined;
    onChange: (filter: Record<string, any>) => void;
}

export const NUMBER_OPERATORS = ['eq', 'gt', 'gte', 'lt', 'lte', 'isNull', 'between'] as const;

export function DataTableNumberFilter({
    mode,
    value: incomingValue,
    onChange,
}: Readonly<DataTableNumberFilterProps>) {
    const { activeChannel } = useChannel();
    const initialOperator = incomingValue ? Object.keys(incomingValue)[0] : 'eq';
    const initialValue = incomingValue ? Object.values(incomingValue)[0] : 0;
    const [operator, setOperator] = useState<string>(initialOperator ?? 'eq');
    const [value, setValue] = useState<string>(initialValue?.toString() ?? '');
    const [minValue, setMinValue] = useState<string>('');
    const [maxValue, setMaxValue] = useState<string>('');
    const [error, setError] = useState<string>('');

    useEffect(() => {
        if (operator === 'isNull') {
            onChange({ [operator]: true });
            return;
        }

        if (operator === 'between') {
            if (!minValue && !maxValue) {
                onChange({});
                return;
            }
            if (!minValue || !maxValue) {
                setError('Please enter both min and max values');
                return;
            }
            const minNum = Number.parseFloat(minValue);
            const maxNum = Number.parseFloat(maxValue);
            if (Number.isNaN(minNum) || Number.isNaN(maxNum)) {
                setError('Please enter valid numbers');
                return;
            }
            if (minNum > maxNum) {
                setError('Min value must be less than max value');
                return;
            }
            setError('');
            onChange({ [operator]: { start: minNum, end: maxNum } });
        } else {
            if (!value) {
                onChange({});
                return;
            }
            const numValue = Number.parseFloat(value);
            if (Number.isNaN(numValue)) {
                setError('Please enter a valid number');
                return;
            }
            setError('');
            onChange({ [operator]: numValue });
        }
    }, [operator, value, minValue, maxValue]);

    const renderInput = (value: string, onChange: (value: string) => void, placeholder: string) => {
        if (mode === 'money') {
            return (
                <MoneyInput
                    ref={() => {}}
                    onBlur={() => {}}
                    name="amount"
                    value={Number.parseFloat(value) || 0}
                    onChange={newValue => onChange(newValue.toString())}
                    currency={activeChannel?.defaultCurrencyCode ?? 'USD'}
                />
            );
        }
        return (
            <Input
                type="number"
                placeholder={placeholder}
                value={value}
                onChange={e => onChange(e.target.value)}
            />
        );
    };

    return (
        <div className="flex flex-col gap-2">
            <div className="flex flex-col md:flex-row gap-2">
                <Select
                    items={Object.fromEntries(NUMBER_OPERATORS.map(op => [op, <HumanReadableOperator key={op} operator={op} />]))}
                    value={operator}
                    onValueChange={value => value != null && setOperator(value)}
                >
                    <SelectTrigger>
                        <SelectValue placeholder="Select operator" />
                    </SelectTrigger>
                    <SelectContent>
                        {NUMBER_OPERATORS.map(op => (
                            <SelectItem key={op} value={op}>
                                <HumanReadableOperator operator={op} />
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                {operator !== 'isNull' &&
                    (operator === 'between' ? (
                        <div className="flex gap-2">
                            {renderInput(minValue, setMinValue, 'Min')}
                            {renderInput(maxValue, setMaxValue, 'Max')}
                        </div>
                    ) : (
                        renderInput(value, setValue, 'Enter value...')
                    ))}
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
    );
}
