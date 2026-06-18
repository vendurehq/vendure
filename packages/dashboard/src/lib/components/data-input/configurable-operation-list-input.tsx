import { FormControlAdapter } from '@/vdb/framework/form-engine/form-control-adapter.js';
import { DashboardFormComponentProps } from '@/vdb/framework/form-engine/form-engine-types.js';
import { isCustomFieldConfig } from '@/vdb/framework/form-engine/utils.js';
import { ControllerRenderProps } from 'react-hook-form';

/**
 * A dynamic array input component for configurable operation arguments that handle lists of values.
 */
export function ConfigurableOperationListInput({
    fieldDef,
    value,
    onChange,
    disabled,
}: Readonly<DashboardFormComponentProps>) {
    if (!fieldDef || isCustomFieldConfig(fieldDef)) {
        return null;
    }
    const arrayValue = parseArrayValue(value);
    return (
        <div className="space-y-2">
            {arrayValue.map((item, index) => {
                const field = {
                    value: item,
                    onChange,
                    disabled: disabled ?? false,
                    onBlur: () => {},
                    name: fieldDef.name,
                    ref: () => {},
                } satisfies ControllerRenderProps<any, any>;
                return (
                    <div key={`array-item-${index}`} className="flex items-center gap-2">
                        <div className="flex-1">
                            <FormControlAdapter field={field} fieldDef={fieldDef} valueMode="native" />
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

function parseArrayValue(value: string): string[] {
    if (!value) return [];

    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.map(String) : [String(parsed)];
    } catch {
        // If not JSON, try comma-separated values
        return value.includes(',')
            ? value
                  .split(',')
                  .map(s => s.trim())
                  .filter(Boolean)
            : value
              ? [value]
              : [];
    }
}
