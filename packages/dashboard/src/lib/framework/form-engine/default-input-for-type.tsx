import { BooleanInput } from '@/vdb/components/data-input/boolean-input.js';
import { DefaultRelationInput } from '@/vdb/components/data-input/default-relation-input.js';
import { DateTimeInput, SelectWithOptions } from '@/vdb/components/data-input/index.js';
import { NumberInput } from '@/vdb/components/data-input/number-input.js';
import { TextInput } from '@/vdb/components/data-input/text-input.js';
import { DashboardFormComponentProps } from '@/vdb/framework/form-engine/form-engine-types.js';
import { isStringFieldWithOptions } from '@/vdb/framework/form-engine/utils.js';

/**
 * Consolidated input component for rendering form inputs based on field type
 * This replaces the duplicate implementations in custom fields and config args
 */
export function DefaultInputForType({ fieldDef, ...fieldProps }: Readonly<DashboardFormComponentProps>) {
    const type = fieldDef?.type;
    switch (type) {
        case 'int':
        case 'float':
            return <NumberInput {...fieldProps} fieldDef={fieldDef} />;
        case 'boolean':
            return <BooleanInput {...fieldProps} fieldDef={fieldDef} />;
        case 'datetime':
            return <DateTimeInput {...fieldProps} fieldDef={fieldDef} />;
        case 'relation':
            return <DefaultRelationInput {...fieldProps} fieldDef={fieldDef} />;
        case 'string': {
            if (fieldDef && isStringFieldWithOptions(fieldDef)) {
                return <SelectWithOptions {...fieldProps} fieldDef={fieldDef} />;
            } else {
                return <TextInput {...fieldProps} fieldDef={fieldDef} />;
            }
        }
        default:
            return <TextInput {...fieldProps} fieldDef={fieldDef} />;
    }
}
