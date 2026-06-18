import { CustomFieldListInput } from '@/vdb/components/data-input/custom-field-list-input.js';
import { StructFormInput } from '@/vdb/components/data-input/struct-form-input.js';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/vdb/components/ui/field.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/vdb/components/ui/tabs.js';
import { getInputComponent } from '@/vdb/framework/extension-api/input-component-extensions.js';
import { CustomFormComponent } from '@/vdb/framework/form-engine/custom-form-component.js';
import { ConfigurableFieldDef } from '@/vdb/framework/form-engine/form-engine-types.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { useCustomFieldConfig } from '@/vdb/hooks/use-custom-field-config.js';
import { useUserSettings } from '@/vdb/hooks/use-user-settings.js';
import { getLocaleFallbackPlaceholder } from '@/vdb/utils/get-locale-fallback-placeholder.js';
import { customFieldConfigFragment } from '@/vdb/providers/server-config.js';
import { useLingui } from '@lingui/react/macro';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { ResultOf } from 'gql.tada';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Control, Controller, ControllerFieldState, useFormContext } from 'react-hook-form';
import { applyControlProps } from './apply-control-props.js';
import { FormControlAdapter } from '../../framework/form-engine/form-control-adapter.js';
import { TranslatableFormField } from './translatable-form-field.js';

type CustomFieldConfig = Omit<ResultOf<typeof customFieldConfigFragment>, '__typename'>;

interface CustomFieldsFormProps {
    entityType: string;
    control: Control<any, any>;
    formPathPrefix?: string;
    disabled?: boolean;
}

export function CustomFieldsForm({ entityType, control, formPathPrefix, disabled }: Readonly<CustomFieldsFormProps>) {
    const { t } = useLingui();
    const customFields = useCustomFieldConfig(entityType);

    const getCustomFieldBaseName = (fieldDef: CustomFieldConfig) => {
        if (fieldDef.type !== 'relation') {
            return fieldDef.name;
        }
        return fieldDef.list ? fieldDef.name + 'Ids' : fieldDef.name + 'Id';
    };

    const getFieldName = (fieldDef: CustomFieldConfig) => {
        const name = getCustomFieldBaseName(fieldDef);
        return formPathPrefix ? `${formPathPrefix}.customFields.${name}` : `customFields.${name}`;
    };

    // Group custom fields by tabs
    const groupedFields = useMemo(() => {
        if (!customFields) return [];

        const tabMap = new Map<string, CustomFieldConfig[]>();
        const defaultTabName = '__default_tab__';

        for (const field of customFields) {
            const tabName = field.ui?.tab ?? defaultTabName;
            if (tabMap.has(tabName)) {
                tabMap.get(tabName)?.push(field);
            } else {
                tabMap.set(tabName, [field]);
            }
        }

        return Array.from(tabMap.entries())
            .sort((a, b) => (a[0] === defaultTabName ? -1 : 1))
            .map(([tabName, customFields]) => ({
                tabName: tabName === defaultTabName ? 'general' : tabName,
                customFields,
            }));
    }, [customFields]);

    // Check if we should show tabs (more than one tab or at least one field has a tab)
    const shouldShowTabs = useMemo(() => {
        if (!customFields) return false;
        const hasTabbedFields = customFields.some(field => field.ui?.tab);
        return hasTabbedFields && groupedFields.length > 1;
    }, [customFields, groupedFields.length]);

    if (!shouldShowTabs) {
        // Single tab view - use the original grid layout
        return (
            <div className="grid @md:grid-cols-2 gap-6">
                {customFields?.map(fieldDef => (
                    <CustomFieldItem
                        key={fieldDef.name}
                        fieldDef={fieldDef}
                        control={control}
                        fieldName={getFieldName(fieldDef)}
                        disabled={disabled}
                    />
                ))}
            </div>
        );
    }

    // Tabbed view
    return (
        <Tabs defaultValue={groupedFields[0]?.tabName} className="w-full">
            <ScrollableTabsList>
                {groupedFields.map(group => (
                    <TabsTrigger key={group.tabName} value={group.tabName} className="shrink-0">
                        {group.tabName === 'general' ? t`General` : group.tabName}
                    </TabsTrigger>
                ))}
            </ScrollableTabsList>
            {groupedFields.map(group => (
                <TabsContent key={group.tabName} value={group.tabName} className="mt-4">
                    <div className="grid @md:grid-cols-2 gap-6">
                        {group.customFields.map(fieldDef => (
                            <CustomFieldItem
                                key={fieldDef.name}
                                fieldDef={fieldDef}
                                control={control}
                                fieldName={getFieldName(fieldDef)}
                                disabled={disabled}
                            />
                        ))}
                    </div>
                </TabsContent>
            ))}
        </Tabs>
    );
}

function ScrollableTabsList({ children }: Readonly<{ children: React.ReactNode }>) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [canScrollLeft, setCanScrollLeft] = useState(false);
    const [canScrollRight, setCanScrollRight] = useState(false);

    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        const updateScrollState = () => {
            const isRTL = getComputedStyle(el).direction === 'rtl';
            if (isRTL) {
                setCanScrollRight(el.scrollLeft < -1);
                setCanScrollLeft(Math.abs(el.scrollLeft) + el.clientWidth < el.scrollWidth - 1);
            } else {
                setCanScrollLeft(el.scrollLeft > 0);
                setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
            }
        };
        updateScrollState();
        const observer = new ResizeObserver(updateScrollState);
        observer.observe(el);
        el.addEventListener('scroll', updateScrollState, { passive: true });
        return () => {
            observer.disconnect();
            el.removeEventListener('scroll', updateScrollState);
        };
    }, []);

    const scroll = (direction: 'left' | 'right') => {
        const el = scrollRef.current;
        if (!el) return;
        el.scrollBy({ left: direction === 'left' ? -200 : 200, behavior: 'smooth' });
    };

    return (
        <div className="relative">
            {canScrollLeft && (
                <button
                    type="button"
                    onClick={() => scroll('left')}
                    className="absolute left-0 top-0 z-10 flex h-full items-center bg-gradient-to-r from-muted via-muted/80 to-transparent pl-1 pr-3"
                    aria-label="Scroll tabs left"
                >
                    <ChevronLeft className="h-4 w-4" />
                </button>
            )}
            <TabsList
                ref={scrollRef}
                className="h-auto w-full min-w-0 justify-start overflow-x-auto overflow-y-hidden scrollbar-none"
            >
                {children}
            </TabsList>
            {canScrollRight && (
                <button
                    type="button"
                    onClick={() => scroll('right')}
                    className="absolute right-0 top-0 z-10 flex h-full items-center bg-gradient-to-l from-muted via-muted/80 to-transparent pl-3 pr-1"
                    aria-label="Scroll tabs right"
                >
                    <ChevronRight className="h-4 w-4" />
                </button>
            )}
        </div>
    );
}
interface CustomFieldItemProps {
    fieldDef: ConfigurableFieldDef;
    control: Control<any>;
    fieldName: string;
    disabled?: boolean;
}

function CustomFieldItem({ fieldDef, control, fieldName, disabled }: Readonly<CustomFieldItemProps>) {
    const {
        settings: { displayLanguage, contentLanguage },
    } = useUserSettings();
    const { activeChannel } = useChannel();
    const { watch } = useFormContext();
    const translations = watch('translations');
    const defaultLanguageCode = activeChannel?.defaultLanguageCode;

    const getTranslation = (
        input: string | Array<{ languageCode: string; value: string }> | null | undefined,
    ) => {
        if (typeof input === 'string') {
            return input;
        }
        return input?.find(t => t.languageCode === displayLanguage)?.value;
    };
    const hasCustomFormComponent = fieldDef.ui?.component;
    const isLocaleField = fieldDef.type === 'localeString' || fieldDef.type === 'localeText';
    const customInputComponentId = typeof fieldDef.ui?.component === 'string' ? fieldDef.ui.component : undefined;
    const inputComponent = getInputComponent(customInputComponentId);
    const shouldBeFullWidth =
        fieldDef.ui?.fullWidth === true || inputComponent?.metadata?.isFullWidth === true;
    const containerClassName = shouldBeFullWidth ? 'col-span-2' : '';
    const isReadonly = (fieldDef as CustomFieldConfig).readonly ?? false;

    const localeFallbackPlaceholder = useMemo(
        () =>
            isLocaleField
                ? getLocaleFallbackPlaceholder(translations, defaultLanguageCode, contentLanguage, `customFields.${fieldDef.name}`)
                : undefined,
        [isLocaleField, translations, defaultLanguageCode, contentLanguage, fieldDef.name],
    );

    // For locale fields, always use TranslatableFormField regardless of custom components
    if (isLocaleField) {
        return (
            <div className={containerClassName}>
                <TranslatableFormField
                    control={control}
                    name={fieldName}
                    disabled={disabled}
                    render={({ field, fieldState }) => {
                        const inputElement = hasCustomFormComponent ? (
                            <CustomFormComponent fieldDef={fieldDef} {...field} />
                        ) : (
                            <FormControlAdapter
                                fieldDef={fieldDef}
                                field={field}
                                valueMode="native"
                            />
                        );
                        return (
                            <CustomFieldFormItem
                                fieldDef={fieldDef}
                                getTranslation={getTranslation}
                                fieldName={field.name}
                                fieldState={fieldState}
                            >
                                {localeFallbackPlaceholder
                                    ? applyControlProps(inputElement, { placeholder: localeFallbackPlaceholder })
                                    : inputElement}
                            </CustomFieldFormItem>
                        );
                    }}
                />
            </div>
        );
    }

    // For non-locale fields with custom components
    if (hasCustomFormComponent) {
        return (
            <div className={containerClassName}>
                <Controller
                    control={control}
                    name={fieldName}
                    disabled={disabled}
                    render={({ field, fieldState }) => (
                        <CustomFieldFormItem
                            fieldDef={fieldDef}
                            getTranslation={getTranslation}
                            fieldName={field.name}
                            fieldState={fieldState}
                        >
                            <CustomFormComponent fieldDef={fieldDef} {...field} />
                        </CustomFieldFormItem>
                    )}
                />
            </div>
        );
    }

    // For struct fields, use the special struct component
    if (fieldDef.type === 'struct') {
        const isList = fieldDef.list ?? false;

        // Handle struct lists - entire struct objects in a list
        if (isList) {
            return (
                <div className={containerClassName}>
                    <Controller
                        control={control}
                        name={fieldName}
                        disabled={disabled}
                        render={({ field, fieldState }) => (
                            <CustomFieldFormItem
                                fieldDef={fieldDef}
                                getTranslation={getTranslation}
                                fieldName={fieldDef.name}
                                fieldState={fieldState}
                            >
                                <CustomFieldListInput
                                    {...field}
                                    disabled={isReadonly}
                                    renderInput={(index, inputField) => (
                                        <StructFormInput {...inputField} fieldDef={fieldDef} />
                                    )}
                                    defaultValue={{}} // Empty struct object as default
                                />
                            </CustomFieldFormItem>
                        )}
                    />
                </div>
            );
        }

        // Handle single struct fields
        return (
            <div className={containerClassName}>
                <Controller
                    control={control}
                    name={fieldName}
                    disabled={disabled}
                    render={({ field, fieldState }) => (
                        <CustomFieldFormItem
                            fieldDef={fieldDef}
                            getTranslation={getTranslation}
                            fieldName={fieldDef.name}
                            fieldState={fieldState}
                        >
                            <StructFormInput {...field} fieldDef={fieldDef} />
                        </CustomFieldFormItem>
                    )}
                />
            </div>
        );
    }

    // For regular fields without custom components
    return (
        <div className={containerClassName}>
            <Controller
                control={control}
                name={fieldName}
                disabled={disabled}
                render={({ field, fieldState }) => (
                    <CustomFieldFormItem
                        fieldDef={fieldDef}
                        getTranslation={getTranslation}
                        fieldName={fieldDef.name}
                        fieldState={fieldState}
                    >
                        <FormControlAdapter fieldDef={fieldDef} field={field} valueMode="native" />
                    </CustomFieldFormItem>
                )}
            />
        </div>
    );
}

interface CustomFieldFormItemProps {
    fieldDef: ConfigurableFieldDef;
    getTranslation: (
        input: string | Array<{ languageCode: string; value: string }> | null | undefined,
    ) => string | undefined;
    fieldName: string;
    fieldState?: ControllerFieldState;
    children: React.ReactNode;
}

function CustomFieldFormItem({
    fieldDef,
    getTranslation,
    fieldName,
    fieldState,
    children,
}: Readonly<CustomFieldFormItemProps>) {
    const fieldId = `field-${fieldName}`;
    return (
        <Field data-invalid={fieldState?.invalid || undefined}>
            <FieldLabel htmlFor={fieldId}>{getTranslation(fieldDef.label) ?? fieldName}</FieldLabel>
            {children}
            {getTranslation(fieldDef.description) && (
                <FieldDescription>{getTranslation(fieldDef.description)}</FieldDescription>
            )}
            {fieldState?.invalid && <FieldError errors={[fieldState.error]} />}
        </Field>
    );
}
