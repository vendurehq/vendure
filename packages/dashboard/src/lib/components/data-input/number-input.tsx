import { AffixedInput } from '@/vdb/components/data-input/affixed-input.js';
import { Input } from '@/vdb/components/ui/input.js';

import { DashboardFormComponentProps } from '@/vdb/framework/form-engine/form-engine-types.js';
import { isReadonlyField } from '@/vdb/framework/form-engine/utils.js';
import { ReactNode } from 'react';

export type NumberInputProps = DashboardFormComponentProps & {
    min?: number;
    max?: number;
    step?: number;
    prefix?: ReactNode;
    suffix?: ReactNode;
};

/**
 * @description
 * A component for displaying a numeric value.
 *
 * @docsCategory form-components
 * @docsPage NumberInput
 */
export function NumberInput({
    fieldDef,
    onChange,
    prefix: overridePrefix,
    suffix: overrideSuffix,
    ...fieldProps
}: Readonly<NumberInputProps>) {
    const readOnly = fieldProps.disabled || isReadonlyField(fieldDef);
    const isFloat = fieldDef ? fieldDef.type === 'float' : false;
    const min = fieldProps.min ?? fieldDef?.ui?.min;
    const max = fieldProps.max ?? fieldDef?.ui?.max;
    const step = fieldProps.step ?? (fieldDef?.ui?.step || (isFloat ? 0.01 : 1));
    const prefix = overridePrefix ?? fieldDef?.ui?.prefix;
    const suffix = overrideSuffix ?? fieldDef?.ui?.suffix;
    const shouldUseAffixedInput = prefix || suffix;
    const value = fieldProps.value ?? '';
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (readOnly) return;

        let numValue = e.target.valueAsNumber;

        if (Number.isNaN(numValue) && e.target.value) {
            const normalized = e.target.value.replace(',', '.');
            numValue = Number(normalized);
        }

        if (Number.isNaN(numValue)) {
            onChange(null);
        } else {
            onChange(numValue);
        }
    };
    if (shouldUseAffixedInput) {
        return (
            <AffixedInput
                {...fieldProps}
                value={value}
                type="number"
                onChange={handleChange}
                min={min}
                max={max}
                step={step}
                prefix={prefix}
                suffix={suffix}
                className="bg-background"
                disabled={readOnly}
            />
        );
    }

    return (
        <Input
            type="number"
            onChange={handleChange}
            {...fieldProps}
            value={value}
            min={min}
            max={max}
            step={step}
            disabled={readOnly}
        />
    );
}
