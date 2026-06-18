import { Button } from '@/vdb/components/ui/button.js';
import { Input } from '@/vdb/components/ui/input.js';
import { DashboardFormComponentProps } from '@/vdb/framework/form-engine/form-engine-types.js';
import { isFieldDisabled } from '@/vdb/framework/form-engine/utils.js';
import { api } from '@/vdb/graphql/api.js';
import { graphql } from '@/vdb/graphql/graphql.js';
import { useUserSettings } from '@/vdb/hooks/use-user-settings.js';
import { cn } from '@/vdb/lib/utils.js';
import { useLingui } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import { useDebounce } from '@uidotdev/usehooks';
import { Edit, Lock, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';

const slugForEntityDocument = graphql(`
    query SlugForEntity($input: SlugForEntityInput!) {
        slugForEntity(input: $input)
    }
`);

function resolveWatchFieldPath(
    currentFieldName: string,
    watchFieldName: string,
    formValues: any,
    contentLanguage: string,
): string {
    const translationsMatch = currentFieldName.match(/^translations\.(\d+)\./);

    if (translationsMatch) {
        const index = translationsMatch[1];

        if (formValues?.translations?.[index]?.hasOwnProperty(watchFieldName)) {
            return `translations.${index}.${watchFieldName}`;
        }

        if (formValues?.hasOwnProperty(watchFieldName)) {
            return watchFieldName;
        }

        return `translations.${index}.${watchFieldName}`;
    }

    if (formValues?.translations && Array.isArray(formValues.translations)) {
        const translations = formValues.translations;
        const existingIndex = translations.findIndex(
            (translation: any) => translation?.languageCode === contentLanguage,
        );
        const index = existingIndex === -1 ? (translations.length > 0 ? 0 : -1) : existingIndex;

        if (index >= 0 && translations[index]?.hasOwnProperty(watchFieldName)) {
            return `translations.${index}.${watchFieldName}`;
        }
    }

    return watchFieldName;
}

export interface SlugInputProps extends DashboardFormComponentProps {
    /**
     * @description
     * The name of the entity (e.g., 'Product', 'Collection')
     */
    entityName: string;
    /**
     * @description
     * The name of the field to check for uniqueness (e.g., 'slug', 'code')
     */
    fieldName: string;
    /**
     * @description
     * The name of the field to watch for changes (e.g., 'name', 'title', 'enabled').
     * The component automatically resolves whether this field exists in translations
     * or on the base entity. For translatable fields like 'name', it will watch
     * 'translations.X.name'. For non-translatable fields like 'enabled', it will
     * watch 'enabled' directly.
     */
    watchFieldName: string;
    /**
     * @description
     * Optional entity ID for updates (excludes from uniqueness check)
     */
    entityId?: string | number;
    /**
     * @description
     * Whether the input should start in readonly mode. Default: true
     */
    defaultReadonly?: boolean;

    /**
     * @description Class name for the <Input> component
     */
    className?: string;
}

/**
 * @description
 * A component for generating and displaying slugs based on a watched field.
 * The component watches a source field for changes, debounces the input,
 * and generates a unique slug via the Admin API. The slug is only auto-generated
 * when it's empty. For existing slugs, a regenerate button allows manual regeneration.
 * The input is readonly by default but can be made editable with a toggle button.
 *
 * @example
 * ```tsx
 * // In a TranslatableFormFieldWrapper context with translatable field
 * <SlugInput
 *     {...field}
 *     entityName="Product"
 *     fieldName="slug"
 *     watchFieldName="name" // Automatically resolves to "translations.X.name"
 *     entityId={productId}
 * />
 *
 * // In a TranslatableFormFieldWrapper context with non-translatable field
 * <SlugInput
 *     {...field}
 *     entityName="Product"
 *     fieldName="slug"
 *     watchFieldName="enabled" // Uses "enabled" directly (base entity field)
 *     entityId={productId}
 * />
 *
 * // For non-translatable entities
 * <SlugInput
 *     {...field}
 *     entityName="Channel"
 *     fieldName="code"
 *     watchFieldName="name" // Uses "name" directly
 *     entityId={channelId}
 * />
 * ```
 *
 * @docsCategory form-components
 * @docsPage SlugInput
 */
export function SlugInput({
    value,
    onChange,
    fieldDef,
    disabled,
    entityName,
    fieldName,
    watchFieldName,
    entityId,
    defaultReadonly = true,
    className,
    name,
    placeholder: externalPlaceholder,
    ...props
}: SlugInputProps & { placeholder?: string }) {
    const { t } = useLingui();
    const form = useFormContext();
    const { contentLanguage } = useUserSettings().settings;
    const isFormReadonly = isFieldDisabled(disabled, fieldDef);
    const [isManuallyReadonly, setIsManuallyReadonly] = useState(defaultReadonly);
    const isReadonly = isFormReadonly || isManuallyReadonly;

    const actualWatchFieldName = resolveWatchFieldPath(
        name || '',
        watchFieldName,
        form?.getValues(),
        contentLanguage,
    );

    const watchedValue = useWatch({
        control: form?.control,
        name: actualWatchFieldName,
    });

    const watchFieldState = form.getFieldState(actualWatchFieldName);
    const debouncedWatchedValue = useDebounce(watchedValue, 500);
    const shouldAutoGenerate = isReadonly && !entityId && watchFieldState.isDirty;
    const queryKey = ['slugForEntity', entityName, fieldName, debouncedWatchedValue, entityId];
    const enabled = !!debouncedWatchedValue && shouldAutoGenerate;
    const {
        data: generatedSlug,
        isLoading,
        refetch,
    } = useQuery({
        queryKey,
        queryFn: async () => {
            if (!debouncedWatchedValue) {
                return '';
            }
            const result = await api.query(slugForEntityDocument, {
                input: {
                    entityName,
                    fieldName,
                    inputValue: debouncedWatchedValue,
                    entityId: entityId?.toString(),
                },
            });

            return result.slugForEntity;
        },
        enabled,
    });

    useEffect(() => {
        if (shouldAutoGenerate && generatedSlug && generatedSlug !== value) {
            onChange?.(generatedSlug);
        }
    }, [generatedSlug, shouldAutoGenerate, value, onChange]);

    const toggleReadonly = () => {
        if (!isFormReadonly) {
            setIsManuallyReadonly(!isManuallyReadonly);
        }
    };

    const handleRegenerate = async () => {
        if (watchedValue) {
            const result = await refetch();
            if (result.data) {
                onChange?.(result.data);
            }
        }
    };

    const handleChange = (newValue: string) => {
        onChange?.(newValue);
    };

    const displayValue = shouldAutoGenerate && generatedSlug ? generatedSlug : value || '';
    const showLoading = isLoading && shouldAutoGenerate;

    return (
        <div className="relative flex items-center gap-2">
            <div className="flex-1 relative">
                <Input
                    value={displayValue}
                    onChange={e => handleChange(e.target.value)}
                    disabled={isReadonly}
                    placeholder={
                        isReadonly
                            ? value
                                ? t`Slug is set`
                                : externalPlaceholder || t`Slug will be generated automatically...`
                            : t`Enter slug manually`
                    }
                    className={cn(
                        'pr-8',
                        isReadonly && 'bg-muted text-muted-foreground',
                        showLoading && 'text-muted-foreground',
                        className,
                    )}
                    {...props}
                />
                {showLoading && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
                    </div>
                )}
            </div>

            {!isFormReadonly && (
                <>
                    {isManuallyReadonly && value && (
                        <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={handleRegenerate}
                            className="shrink-0"
                            title={t`Regenerate slug from source field`}
                            aria-label={t`Regenerate slug from source field`}
                            disabled={!watchedValue || isLoading}
                        >
                            <RefreshCw className="h-4 w-4" />
                        </Button>
                    )}

                    <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={toggleReadonly}
                        className="shrink-0"
                        title={isManuallyReadonly ? t`Edit slug manually` : t`Generate slug automatically`}
                        aria-label={
                            isManuallyReadonly ? t`Edit slug manually` : t`Generate slug automatically`
                        }
                    >
                        {isManuallyReadonly ? <Edit className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                    </Button>
                </>
            )}
        </div>
    );
}
