import { OverriddenFormComponent } from '@/vdb/framework/form-engine/overridden-form-component.js';
import { LocationWrapper } from '@/vdb/framework/layout-engine/location-wrapper.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { useLocalFormat } from '@/vdb/hooks/use-local-format.js';
import { useUserSettings } from '@/vdb/hooks/use-user-settings.js';
import { getLocaleFallbackPlaceholder } from '@/vdb/utils/get-locale-fallback-placeholder.js';
import { Trans } from '@lingui/react/macro';
import { CircleAlert } from 'lucide-react';
import React, { useEffect, useMemo } from 'react';
import { Controller, ControllerProps, FieldPath, FieldValues, useFormContext } from 'react-hook-form';
import { Badge } from '../ui/badge.js';
import { Field, FieldDescription, FieldError, FieldLabel } from '../ui/field.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select.js';
import { applyControlProps } from './apply-control-props.js';
import { FormFieldWrapper } from './form-field-wrapper.js';
import { TranslatableFormGroupContext, useResolvedContentLanguage } from './translatable-form-context.js';

function getValueAtPath(value: unknown, path: string): unknown {
    return path.split('.').reduce<any>((current, segment) => current?.[segment], value);
}

/**
 * @description
 * Groups translatable form fields under synchronized, field-level language selectors. Switching the
 * selected language from any localized field only changes which entry in the form's `translations` array
 * is edited; it does not change the Dashboard's global content language.
 *
 * @docsCategory form-components
 * @docsPage TranslatableFormFieldWrapper
 * @since 3.8.0
 */
export function TranslatableFormGroup({
    children,
    className,
}: Readonly<{ children: React.ReactNode; className?: string }>) {
    const { activeChannel } = useChannel();
    const { contentLanguage } = useUserSettings().settings;
    const {
        formState: { errors, submitCount },
        watch,
    } = useFormContext();
    const translations = watch('translations') as Array<{ languageCode?: string }> | undefined;
    const languages = useMemo(
        () => activeChannel?.availableLanguageCodes ?? [],
        [activeChannel?.availableLanguageCodes],
    );
    const getInitialLanguage = () =>
        languages.includes(contentLanguage as any)
            ? contentLanguage
            : (activeChannel?.defaultLanguageCode ?? languages[0] ?? contentLanguage);
    const [languageCode, setLanguageCode] = React.useState(getInitialLanguage);
    const [registeredFields, setRegisteredFields] = React.useState<string[]>([]);
    const previousSubmitCount = React.useRef(submitCount);

    const registerField = React.useCallback((fieldName: string) => {
        setRegisteredFields(current => (current.includes(fieldName) ? current : [...current, fieldName]));
        return () => setRegisteredFields(current => current.filter(name => name !== fieldName));
    }, []);

    const languagesWithErrors = useMemo(
        () =>
            languages.filter(code => {
                const translationIndex =
                    translations?.findIndex(translation => translation?.languageCode === code) ?? -1;
                if (translationIndex < 0) {
                    return false;
                }
                const translationErrors = (errors as any)?.translations?.[translationIndex];
                return registeredFields.some(
                    fieldName => getValueAtPath(translationErrors, fieldName) != null,
                );
            }),
        [errors, languages, registeredFields, translations],
    );

    useEffect(() => {
        if (!languages.includes(languageCode as any)) {
            setLanguageCode(activeChannel?.defaultLanguageCode ?? languages[0] ?? contentLanguage);
        }
    }, [activeChannel?.defaultLanguageCode, contentLanguage, languageCode, languages]);

    useEffect(() => {
        if (submitCount > previousSubmitCount.current && languagesWithErrors.length > 0) {
            setLanguageCode(languagesWithErrors[0]);
        }
        previousSubmitCount.current = submitCount;
    }, [languagesWithErrors, submitCount]);

    return (
        <TranslatableFormGroupContext.Provider
            value={{ languageCode, languages, languagesWithErrors, setLanguageCode, registerField }}
        >
            <div className={className}>{children}</div>
        </TranslatableFormGroupContext.Provider>
    );
}

/**
 * A field label with an inline language selector which stays synchronized with every other localized
 * field in the nearest {@link TranslatableFormGroup}.
 */
export function TranslatableFormFieldLabel({ children, ...props }: React.ComponentProps<typeof FieldLabel>) {
    return (
        <div className="flex min-h-6 items-center gap-2">
            <FieldLabel {...props}>{children}</FieldLabel>
            <TranslatableFormLanguageSelector />
        </div>
    );
}

function TranslatableFormLanguageSelector() {
    const group = React.useContext(TranslatableFormGroupContext);
    const { formatLanguageName } = useLocalFormat();

    if (!group || group.languages.length === 0) {
        return null;
    }

    const { languageCode, languages, languagesWithErrors, setLanguageCode } = group;
    const languageName = formatLanguageName(languageCode);

    if (languages.length === 1) {
        return (
            <Badge variant="outline" className="text-muted-foreground" title={languageName}>
                {languageCode.toUpperCase()}
            </Badge>
        );
    }

    const languageItems = Object.fromEntries(languages.map(code => [code, formatLanguageName(code)]));
    const currentLanguageHasErrors = languagesWithErrors.includes(languageCode);

    return (
        <Select
            items={languageItems}
            value={languageCode}
            onValueChange={value => value != null && setLanguageCode(String(value))}
        >
            <SelectTrigger
                size="sm"
                aria-label={languageName}
                aria-invalid={currentLanguageHasErrors || undefined}
                className="h-6! gap-1 px-1.5 py-0 text-xs font-medium"
            >
                <SelectValue>{languageCode.toUpperCase()}</SelectValue>
                {currentLanguageHasErrors && (
                    <CircleAlert className="size-3 text-destructive" aria-hidden="true" />
                )}
            </SelectTrigger>
            <SelectContent align="start">
                {languages.map(code => {
                    const hasErrors = languagesWithErrors.includes(code);
                    return (
                        <SelectItem key={code} value={code}>
                            <Badge variant="outline" className="min-w-8 px-1.5 text-muted-foreground">
                                {code.toUpperCase()}
                            </Badge>
                            {languageItems[code]}
                            {hasErrors && (
                                <>
                                    <CircleAlert
                                        className="ms-auto me-5 size-4 text-destructive"
                                        aria-hidden="true"
                                    />
                                    <span className="sr-only">
                                        <Trans>Has validation errors</Trans>
                                    </span>
                                </>
                            )}
                        </SelectItem>
                    );
                })}
            </SelectContent>
        </Select>
    );
}

export type TranslatableEntity = FieldValues & {
    translations?: Array<{ languageCode: string }> | null;
};

/**
 * @description
 * The props for the TranslatableFormField component.
 *
 * @docsCategory form-components
 * @docsPage TranslatableFormFieldWrapper
 * @since 3.4.0
 */
export type TranslatableFormFieldProps<TFieldValues extends TranslatableEntity | TranslatableEntity[]> = Omit<
    ControllerProps<TFieldValues>,
    'name'
> & {
    /**
     * @description
     * The label for the form field.
     */
    label?: React.ReactNode;
    /**
     * @description
     * The name of the form field.
     */
    name: TFieldValues extends TranslatableEntity
        ? keyof Omit<NonNullable<TFieldValues['translations']>[number], 'languageCode'>
        : TFieldValues extends TranslatableEntity[]
          ? keyof Omit<NonNullable<TFieldValues[number]['translations']>[number], 'languageCode'>
          : never;
};

export const TranslatableFormField = <
    TFieldValues extends TranslatableEntity | TranslatableEntity[] = TranslatableEntity,
>({
    name,
    label,
    ...props
}: TranslatableFormFieldProps<TFieldValues>) => {
    const { formatLanguageName } = useLocalFormat();
    const contentLanguage = useResolvedContentLanguage();
    const group = React.useContext(TranslatableFormGroupContext);
    const { watch } = useFormContext();

    useEffect(() => {
        if (group) {
            return group.registerField(String(name));
        }
    }, [group?.registerField, name]);
    const formValues = watch();
    const translations = Array.isArray(formValues) ? formValues?.[0]?.translations : formValues?.translations;
    const existingIndex = translations?.findIndex(
        (translation: any) => translation?.languageCode === contentLanguage,
    );
    const isNewTranslation = existingIndex === -1;
    const index = isNewTranslation ? translations?.length : existingIndex;
    if (index === undefined || index === -1) {
        return (
            <Field>
                {label && <TranslatableFormFieldLabel>{label}</TranslatableFormFieldLabel>}
                <div className="text-sm text-muted-foreground">
                    <Trans>No translation found for {formatLanguageName(contentLanguage)}</Trans>
                </div>
            </Field>
        );
    }
    const translationName = `translations.${index}.${String(name)}` as FieldPath<TFieldValues>;
    return (
        <TranslatableFieldController
            {...props}
            name={translationName}
            index={index}
            isNewTranslation={isNewTranslation}
            contentLanguage={contentLanguage}
        />
    );
};

const TranslatableFieldController = <TFieldValues extends TranslatableEntity | TranslatableEntity[]>({
    index,
    isNewTranslation,
    contentLanguage,
    ...props
}: Omit<ControllerProps<TFieldValues>, 'name'> & {
    name: FieldPath<TFieldValues>;
    index: number;
    isNewTranslation: boolean;
    contentLanguage: string;
}) => {
    const { setValue, getValues } = useFormContext();

    useEffect(() => {
        if (isNewTranslation) {
            const translations = getValues('translations') || [];
            const currentLangCode = translations[index]?.languageCode;
            if (currentLangCode !== contentLanguage) {
                setValue(`translations.${index}.languageCode`, contentLanguage, { shouldDirty: true });
            }
        }
    }, [isNewTranslation, index, contentLanguage, setValue, getValues]);

    return <Controller key={`${props.name}-${contentLanguage}`} {...props} />;
};

export type TranslatableFormFieldWrapperProps<
    TFieldValues extends TranslatableEntity | TranslatableEntity[],
> = TranslatableFormFieldProps<TFieldValues> &
    Omit<React.ComponentProps<typeof FormFieldWrapper<TFieldValues>>, 'name'>;

/**
 * @description
 * This is the equivalent of the {@link FormFieldWrapper} component, but for translatable fields.
 *
 * @example
 * ```tsx
 * <TranslatableFormGroup>
 * <PageBlock column="main" blockId="main-form">
 *     <DetailFormGrid>
 *         <TranslatableFormFieldWrapper
 *             control={form.control}
 *             name="name"
 *             label={<Trans>Product name</Trans>}
 *             render={({ field }) => <Input {...field} />}
 *         />
 *         <TranslatableFormFieldWrapper
 *             control={form.control}
 *             name="slug"
 *             label={<Trans>Slug</Trans>}
 *             render={({ field }) => <Input {...field} />}
 *         />
 *     </DetailFormGrid>

 *     <TranslatableFormFieldWrapper
 *         control={form.control}
 *         name="description"
 *         label={<Trans>Description</Trans>}
 *         render={({ field }) => <RichTextInput {...field} />}
 *     />
 * </PageBlock>
 * </TranslatableFormGroup>
 * ```
 *
 * @docsCategory form-components
 * @docsPage TranslatableFormFieldWrapper
 * @docsWeight 0
 * @since 3.4.0
 */
export const TranslatableFormFieldWrapper = <
    TFieldValues extends TranslatableEntity | TranslatableEntity[] = TranslatableEntity,
>({
    label,
    description,
    renderFormControl = true,
    ...controllerProps
}: TranslatableFormFieldWrapperProps<TFieldValues>) => {
    const { name, render, ...rest } = controllerProps;
    const { activeChannel } = useChannel();
    const contentLanguage = useResolvedContentLanguage();
    const { watch } = useFormContext();
    const translations = watch('translations');
    const defaultLanguageCode = activeChannel?.defaultLanguageCode;

    const fallbackPlaceholder = useMemo(
        () => getLocaleFallbackPlaceholder(translations, defaultLanguageCode, contentLanguage, String(name)),
        [translations, defaultLanguageCode, contentLanguage, name],
    );

    return (
        <LocationWrapper identifier={name as string}>
            <TranslatableFormField
                {...rest}
                name={name}
                label={label}
                render={renderArgs => {
                    const { fieldState } = renderArgs;
                    const fieldId = `field-${String(name)}`;
                    const controlProps: Record<string, unknown> = {
                        id: fieldId,
                        'aria-invalid': fieldState.invalid || undefined,
                    };
                    if (fallbackPlaceholder) {
                        controlProps.placeholder = fallbackPlaceholder;
                    }
                    return (
                        <Field data-invalid={fieldState.invalid || undefined}>
                            {label && (
                                <TranslatableFormFieldLabel htmlFor={fieldId}>
                                    {label}
                                </TranslatableFormFieldLabel>
                            )}
                            <OverriddenFormComponent field={renderArgs.field} fieldName={name as string}>
                                {renderFormControl
                                    ? applyControlProps(render(renderArgs), controlProps)
                                    : render(renderArgs)}
                            </OverriddenFormComponent>
                            {description && <FieldDescription>{description}</FieldDescription>}
                            {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                        </Field>
                    );
                }}
            />
        </LocationWrapper>
    );
};
