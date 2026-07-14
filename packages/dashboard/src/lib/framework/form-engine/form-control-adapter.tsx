import { JSX, useMemo } from 'react';
import { ControllerRenderProps } from 'react-hook-form';

import { CustomFieldListInput } from '@/vdb/components/data-input/custom-field-list-input.js';
import { StringListInput } from '@/vdb/components/data-input/string-list-input.js';
import { StructFormInput } from '@/vdb/components/data-input/struct-form-input.js';
import { ConfigurableOperationListInput } from '../../components/data-input/configurable-operation-list-input.js';

import { getInputComponent } from '@/vdb/framework/extension-api/input-component-extensions.js';
import {
    ConfigurableFieldDef,
    DashboardFormComponent,
} from '@/vdb/framework/form-engine/form-engine-types.js';
import { isCustomFieldConfig } from '@/vdb/framework/form-engine/utils.js';
import { DefaultInputForType } from './default-input-for-type.js';
import { transformValue, ValueMode } from './value-transformers.js';

export interface FormControlAdapterProps {
    fieldDef: ConfigurableFieldDef;
    field: ControllerRenderProps<any, any>;
    valueMode: ValueMode;
}

/**
 * Gets the default value for list inputs based on field type
 */
function getDefaultValueForType(fieldType: string): any {
    switch (fieldType) {
        case 'string':
        case 'localeString':
        case 'localeText':
            return '';
        case 'int':
        case 'float':
            return 0;
        case 'boolean':
            return false;
        default:
            return '';
    }
}

/**
 * Validates if a custom component is correctly configured for list fields
 */
function validateCustomComponent(
    CustomComponent: any,
    componentId: string,
    fieldName: string,
    isList: boolean,
): void {
    if (!CustomComponent.metadata?.isListInput || CustomComponent.metadata.isListInput === 'dynamic') {
        return;
    }

    const isConfiguredForList = CustomComponent.metadata.isListInput === true;
    if (isConfiguredForList !== isList) {
        // eslint-disable-next-line no-console
        console.warn([
            `Custom component ${componentId} is not correctly configured for the ${fieldName} field:`,
            `The component ${isConfiguredForList ? 'is' : 'is not'} configured as a list input, but the field ${isList ? 'is' : 'is not'} a list field.`,
        ]);
    }
}

/**
 * Determines if a custom component can be used for the given field configuration
 */
function canUseCustomComponent(
    CustomComponent: DashboardFormComponent | undefined,
    isList: boolean,
): CustomComponent is DashboardFormComponent {
    if (!CustomComponent) return false;

    const listInputMode = CustomComponent.metadata?.isListInput;

    // Dynamic components can handle both list and non-list
    if (listInputMode === 'dynamic') return true;

    // Exact match: both are list or both are non-list
    return (isList && listInputMode === true) || (!isList && listInputMode !== true);
}

/**
 * Renders struct field inputs
 */
function renderStructField(
    fieldDef: ConfigurableFieldDef,
    field: ControllerRenderProps<any, any>,
    fieldWithTransform: ControllerRenderProps<any, any>,
    isList: boolean,
    isReadonly: boolean,
): JSX.Element {
    if (isList) {
        return (
            <CustomFieldListInput
                {...field}
                disabled={isReadonly}
                renderInput={(index, inputField) => (
                    <StructFormInput {...fieldWithTransform} fieldDef={fieldDef} />
                )}
                defaultValue={{}}
            />
        );
    }
    return <StructFormInput {...fieldWithTransform} fieldDef={fieldDef} />;
}

/**
 * Renders list field inputs
 */
function renderListField(
    fieldDef: ConfigurableFieldDef,
    field: ControllerRenderProps<any, any>,
    fieldWithTransform: ControllerRenderProps<any, any>,
    valueMode: ValueMode,
    isReadonly: boolean,
): JSX.Element {
    if (valueMode === 'json-string') {
        return <ConfigurableOperationListInput {...fieldWithTransform} fieldDef={fieldDef} />;
    }

    if (fieldDef.type === 'relation') {
        return <DefaultInputForType {...fieldWithTransform} fieldDef={fieldDef} />;
    }

    if (fieldDef.type === 'string') {
        return <StringListInput {...fieldWithTransform} fieldDef={fieldDef} />;
    }

    return (
        <CustomFieldListInput
            {...field}
            disabled={isReadonly}
            renderInput={(index, inputField) => <DefaultInputForType {...inputField} fieldDef={fieldDef} />}
            defaultValue={getDefaultValueForType(fieldDef.type)}
        />
    );
}

/**
 * This is a wrapper component around the final DashboardFormComponent instances.
 *
 * It is responsible for ensuring the correct props get passed to the final component,
 * and for handling differences between form control use between:
 *
 * - Auto-generated forms
 * - Custom field forms
 * - Configurable operation forms
 */
export function FormControlAdapter({ fieldDef, field, valueMode, ...rest }: Readonly<FormControlAdapterProps> & { placeholder?: string }) {
    const isList = fieldDef.list ?? false;
    const isReadonly = isCustomFieldConfig(fieldDef) ? fieldDef.readonly === true : false;
    const componentId = fieldDef.ui?.component as string | undefined;

    const fieldWithTransform = useMemo(() => {
        const fieldOnChange = field.onChange.bind(field);
        const transformedField: FormControlAdapterProps['field'] = {
            ...field,
            value: transformValue(field.value, fieldDef, valueMode, 'parse'),
            onChange: (newValue: any) => {
                const serializedValue = transformValue(newValue, fieldDef, valueMode, 'serialize');
                fieldOnChange(serializedValue);
            },
        };
        return transformedField;
    }, [field.name, field.value, field.disabled, field.onChange, fieldDef, valueMode]);

    const CustomComponent = getInputComponent(componentId);

    // Try to use custom component if available and compatible
    if (canUseCustomComponent(CustomComponent, isList)) {
        return <CustomComponent {...fieldWithTransform} fieldDef={fieldDef} />;
    }

    // Validate custom component configuration for debugging
    if (CustomComponent) {
        validateCustomComponent(CustomComponent, componentId!, fieldDef.name, isList);
    }

    // Handle struct fields (custom fields mode only)
    if (fieldDef.type === 'struct' && valueMode === 'native') {
        return renderStructField(fieldDef, field, fieldWithTransform, isList, isReadonly);
    }

    // Handle list fields
    if (isList) {
        return renderListField(fieldDef, field, fieldWithTransform, valueMode, isReadonly);
    }

    // Default case: non-list, non-struct fields
    return <DefaultInputForType {...fieldWithTransform} fieldDef={fieldDef} {...rest} />;
}
