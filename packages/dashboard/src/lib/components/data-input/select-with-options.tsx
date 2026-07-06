import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/vdb/components/ui/select.js';
import {
    ConfigurableFieldDef,
    DashboardFormComponent,
    DashboardFormComponentProps,
    StringStructField,
    StructField,
} from '@/vdb/framework/form-engine/form-engine-types.js';
import {
    extractFieldOptions,
    isFieldNullable,
    isReadonlyField,
    isStringFieldWithOptions,
    isStringStructFieldWithOptions,
} from '@/vdb/framework/form-engine/utils.js';
import { useUserSettings } from '@/vdb/hooks/use-user-settings.js';
import { Trans } from '@lingui/react/macro';
import React from 'react';
import { MultiSelect } from '../shared/multi-select.js';

export interface SelectWithOptionsProps extends Omit<DashboardFormComponentProps, 'fieldDef'> {
    placeholder?: React.ReactNode;
    isListField?: boolean;
    /** Field definition - can be a regular custom field or a struct field with options */
    fieldDef?: ConfigurableFieldDef | StructField;
}

/**
 * @description
 * A select component that renders options from custom field configuration.
 * It automatically handles localization of option labels based on user settings.
 *
 * @since 3.3.0
 */
export function SelectWithOptions({
    value,
    onChange,
    fieldDef,
    placeholder,
    isListField = false,
    disabled,
}: Readonly<SelectWithOptionsProps>) {
    // Note: struct fields don't have 'readonly', so isReadonlyField will return false for them
    // which is correct since struct fields are controlled by the parent struct's readonly state
    const readOnly = disabled || isReadonlyField(fieldDef as ConfigurableFieldDef);
    const {
        settings: { displayLanguage },
    } = useUserSettings();

    const getTranslation = (label: Array<{ languageCode: string; value: string }> | null) => {
        if (!label) return '';
        const translation = label.find(t => t.languageCode === displayLanguage);
        return translation?.value ?? label[0]?.value ?? '';
    };

    // Support both regular custom fields and struct fields with options
    const isCustomField = fieldDef && isStringFieldWithOptions(fieldDef as ConfigurableFieldDef);
    const isStructField = fieldDef && isStringStructFieldWithOptions(fieldDef as StringStructField);

    if (!fieldDef || (!isCustomField && !isStructField)) {
        return null;
    }

    const options = extractFieldOptions(fieldDef);

    // Convert options to MultiSelect format
    const multiSelectItems = options.map(option => ({
        value: option.value,
        label: option.label ? getTranslation(option.label) : option.value,
    }));

    // For list fields, use MultiSelect component
    if (isListField || fieldDef?.list === true) {
        return (
            <MultiSelect
                multiple={true}
                value={value || []}
                onChange={onChange}
                items={multiSelectItems}
                placeholder={placeholder ? String(placeholder) : 'Select options'}
                className={readOnly ? 'opacity-50 pointer-events-none' : ''}
            />
        );
    }

    // For single fields, use regular Select
    const isNullable = isFieldNullable(fieldDef);
    const selectValue = isNullable ? (value == null || value === '' ? null : value) : (value ?? '');

    const handleValueChange = (newValue: string | null) => {
        if (isNullable) {
            onChange(newValue ?? null);
        } else if (newValue) {
            onChange(newValue);
        }
    };

    const selectItems = Object.fromEntries(
        options.map(option => [option.value, option.label ? getTranslation(option.label) : option.value]),
    );
    // Add a null item for nullable selects
    if (isNullable) selectItems.null = '';

    return (
        <Select value={selectValue} onValueChange={handleValueChange} disabled={readOnly} items={selectItems}>
            <SelectTrigger className="mb-0">
                <SelectValue placeholder={placeholder || <Trans>Select an option</Trans>} />
            </SelectTrigger>
            <SelectContent>
                {isNullable && <SelectItem value={null}>{'\u00a0'}</SelectItem>}
                {options.map(option => (
                    <SelectItem key={option.value} value={option.value}>
                        {option.label ? getTranslation(option.label) : option.value}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}

(SelectWithOptions as DashboardFormComponent).metadata = {
    isListInput: 'dynamic',
};
