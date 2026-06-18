import { Button } from '@/vdb/components/ui/button.js';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/vdb/components/ui/field.js';
import { Input } from '@/vdb/components/ui/input.js';
import { Switch } from '@/vdb/components/ui/switch.js';
import { getInputComponent } from '@/vdb/framework/extension-api/input-component-extensions.js';
import { useLocalFormat } from '@/vdb/hooks/use-local-format.js';
import { CheckIcon, PencilIcon, X } from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { Controller, ControllerRenderProps, useFormContext, useWatch } from 'react-hook-form';

// Import the form input component we already have
import {
    DashboardFormComponentProps,
    StructCustomFieldConfig,
    StructField,
} from '@/vdb/framework/form-engine/form-engine-types.js';
import {
    isFieldDisabled,
    isStringStructFieldWithOptions,
    isStructFieldConfig,
} from '@/vdb/framework/form-engine/utils.js';
import { useUserSettings } from '@/vdb/hooks/use-user-settings.js';
import { CustomFieldListInput } from './custom-field-list-input.js';
import { DateTimeInput } from './datetime-input.js';
import { SelectWithOptions } from './select-with-options.js';

interface DisplayModeProps {
    fieldDef: StructCustomFieldConfig;
    watchedStructValue: Record<string, any>;
    isReadonly: boolean;
    setIsEditing: (value: boolean) => void;
    getTranslation: (
        input: Array<{ languageCode: string; value: string }> | null | undefined,
    ) => string | undefined;
    formatFieldValue: (value: any, structField: StructField) => React.ReactNode;
}

function DisplayMode({
    fieldDef,
    watchedStructValue,
    isReadonly,
    setIsEditing,
    getTranslation,
    formatFieldValue,
}: Readonly<DisplayModeProps>) {
    return (
        <div className="border rounded-md p-4">
            <div className="flex justify-end">
                {!isReadonly && (
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setIsEditing(true)}
                        className="h-8 w-8 p-0 -mt-2 -mr-2 text-muted-foreground hover:text-foreground"
                    >
                        <PencilIcon className="h-4 w-4" />
                        <span className="sr-only">Edit</span>
                    </Button>
                )}
            </div>
            <dl className="grid grid-cols-2 divide-y divide-muted -mt-2">
                {fieldDef.fields.map(structField => (
                    <React.Fragment key={structField.name}>
                        <dt className="text-sm font-medium text-muted-foreground py-2 min-w-0">
                            {getTranslation(structField.label) ?? structField.name}
                        </dt>
                        <dd className="text-sm text-foreground py-2 min-w-0 break-words">
                            {formatFieldValue(watchedStructValue[structField.name], structField)}
                        </dd>
                    </React.Fragment>
                ))}
            </dl>
        </div>
    );
}

export function StructFormInput({ fieldDef, disabled, ...field }: Readonly<DashboardFormComponentProps>) {
    const { formatDate } = useLocalFormat();
    const [isEditing, setIsEditing] = useState(false);
    const { control } = useFormContext();
    const { value, name } = field;

    // Watch the struct field for changes to update display mode
    const watchedStructValue =
        useWatch({
            control,
            name,
            defaultValue: value || {},
        }) || {};

    const {
        settings: { displayLanguage },
    } = useUserSettings();

    const getTranslation = (input: Array<{ languageCode: string; value: string }> | null | undefined) => {
        return input?.find(t => t.languageCode === displayLanguage)?.value;
    };

    const isReadonly = isFieldDisabled(disabled, fieldDef);

    // Edit mode - memoized to prevent focus loss from re-renders
    const EditMode = useMemo(
        () =>
            fieldDef && isStructFieldConfig(fieldDef) ? (
                <div className="space-y-4 border rounded-md p-4">
                    {!isReadonly && (
                        <div className="flex justify-end">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setIsEditing(false)}
                                className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                            >
                                <CheckIcon className="h-4 w-4" />
                                <span className="sr-only">Done</span>
                            </Button>
                        </div>
                    )}
                    {fieldDef?.fields.map(structField => (
                        <Controller
                            key={structField.name}
                            control={control}
                            name={`${field.name}.${structField.name}`}
                            render={({ field: structInputField, fieldState }) => (
                                <Field data-invalid={fieldState.invalid || undefined}>
                                    <div className="flex items-baseline gap-4">
                                        <div className="flex-1">
                                            <FieldLabel>
                                                {getTranslation(structField.label) ?? structField.name}
                                            </FieldLabel>
                                            {getTranslation(structField.description) && (
                                                <FieldDescription>
                                                    {getTranslation(structField.description)}
                                                </FieldDescription>
                                            )}
                                        </div>
                                        <div className="flex-[2]">
                                            {renderStructFieldInput(
                                                structField,
                                                structInputField,
                                                isReadonly,
                                            )}
                                            {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                                        </div>
                                    </div>
                                </Field>
                            )}
                        />
                    ))}
                </div>
            ) : null,
        [fieldDef, control, field.name, getTranslation, isReadonly],
    );

    // Early return if not a struct field config
    if (!fieldDef || !isStructFieldConfig(fieldDef)) {
        return null;
    }

    // Helper function to format field value for display
    const formatFieldValue = (value: any, structField: StructField) => {
        if (value == null) return '-';
        if (structField.list) {
            if (Array.isArray(value)) {
                return value.length ? value.join(', ') : '-';
            }
            return '-';
        }
        switch (structField.type) {
            case 'boolean':
                return (
                    <span className={`inline-flex items-center ${value ? 'text-success' : 'text-destructive'}`}>
                        {value ? <CheckIcon className="h-4 w-4" /> : <X className="h-4 w-4" />}
                    </span>
                );
            case 'datetime':
                return value ? formatDate(value, { dateStyle: 'short', timeStyle: 'short' }) : '-';
            default:
                return value.toString();
        }
    };

    return isEditing ? (
        EditMode
    ) : (
        <DisplayMode
            fieldDef={fieldDef}
            watchedStructValue={watchedStructValue}
            isReadonly={isReadonly}
            setIsEditing={setIsEditing}
            getTranslation={getTranslation}
            formatFieldValue={formatFieldValue}
        />
    );
}

// Helper function to render individual struct field inputs
const renderStructFieldInput = (
    structField: StructField,
    inputField: ControllerRenderProps<any, any>,
    isReadonly: boolean = false,
) => {
    const isList = structField.list ?? false;

    // Helper function to render single input for a struct field
    const renderSingleStructInput = (singleField: ControllerRenderProps<any, any>) => {
        // Check for custom component via ui.component first
        const customComponentId = structField.ui?.component as string | undefined;
        if (customComponentId) {
            const CustomComponent = getInputComponent(customComponentId);
            if (CustomComponent) {
                // Cast to any since struct fields share the relevant properties with ConfigurableFieldDef
                // (name, type, ui, etc.) but aren't the same union type
                return <CustomComponent {...singleField} fieldDef={structField as any} disabled={isReadonly} />;
            }
        }

        switch (structField.type) {
            case 'string': {
                if (isStringStructFieldWithOptions(structField)) {
                    return (
                        <SelectWithOptions
                            {...singleField}
                            fieldDef={structField}
                            isListField={false}
                            disabled={isReadonly}
                        />
                    );
                }
                return (
                    <Input
                        value={singleField.value ?? ''}
                        onChange={e => singleField.onChange(e.target.value)}
                        onBlur={singleField.onBlur}
                        name={singleField.name}
                        disabled={isReadonly}
                    />
                );
            }
            case 'int':
            case 'float': {
                const isFloat = structField.type === 'float';
                const numericField = structField as any; // GraphQL union types need casting
                const min = isFloat ? numericField.floatMin : numericField.intMin;
                const max = isFloat ? numericField.floatMax : numericField.intMax;
                const step = isFloat ? numericField.floatStep : numericField.intStep;

                return (
                    <Input
                        type="number"
                        value={singleField.value ?? ''}
                        onChange={e => {
                            const value = e.target.valueAsNumber;
                            singleField.onChange(Number.isNaN(value) ? undefined : value);
                        }}
                        onBlur={singleField.onBlur}
                        name={singleField.name}
                        disabled={isReadonly}
                        min={min}
                        max={max}
                        step={step}
                    />
                );
            }
            case 'boolean':
                return (
                    <Switch
                        checked={singleField.value}
                        onCheckedChange={singleField.onChange}
                        disabled={isReadonly}
                    />
                );
            case 'datetime':
                return <DateTimeInput {...singleField} disabled={isReadonly} />;
            default:
                return (
                    <Input
                        value={singleField.value ?? ''}
                        onChange={e => singleField.onChange(e.target.value)}
                        onBlur={singleField.onBlur}
                        name={singleField.name}
                        disabled={isReadonly}
                    />
                );
        }
    };

    // Check for custom component via ui.component first (for list fields)
    const customComponentId = structField.ui?.component as string | undefined;
    if (customComponentId) {
        const CustomComponent = getInputComponent(customComponentId);
        if (CustomComponent) {
            // If the custom component handles lists itself, use it directly
            if (CustomComponent.metadata?.isListInput === true || CustomComponent.metadata?.isListInput === 'dynamic') {
                // Cast to any since struct fields share the relevant properties with ConfigurableFieldDef
                return <CustomComponent {...inputField} fieldDef={structField as any} disabled={isReadonly} />;
            }
        }
    }

    // Handle string fields with options (dropdown) - already handles list case with multi-select
    if (isStringStructFieldWithOptions(structField)) {
        return (
            <SelectWithOptions
                {...inputField}
                fieldDef={structField}
                disabled={isReadonly}
                isListField={isList}
            />
        );
    }

    // For list struct fields, wrap with list input
    if (isList) {
        const getDefaultValue = () => {
            switch (structField.type) {
                case 'string':
                    return '';
                case 'int':
                case 'float':
                    return 0;
                case 'boolean':
                    return false;
                case 'datetime':
                    return '';
                default:
                    return '';
            }
        };

        return (
            <CustomFieldListInput
                {...inputField}
                disabled={isReadonly}
                renderInput={(index, listItemField) => renderSingleStructInput(listItemField)}
                defaultValue={getDefaultValue()}
            />
        );
    }

    // For non-list fields, render directly
    return renderSingleStructInput(inputField);
};
