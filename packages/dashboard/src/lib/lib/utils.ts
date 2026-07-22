import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

/**
 * Converts a camelCase string to Title Case.
 * Examples:
 *   "firstName" -> "First Name"
 *   "dateOfBirth" -> "Date Of Birth"
 *   "totalItems" -> "Total Items"
 */
export function camelCaseToTitleCase(text: string): string {
    if (!text) return '';

    return (
        text
            // Insert space before capital letters
            .replace(/([A-Z])/g, ' $1')
            // Capitalize first character
            .replace(/^./, str => str.toUpperCase())
            // Handle the case where the string starts with a capital
            .trim()
    );
}

/**
 * Formats a file size in bytes to a human-readable string.
 */
export function formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)).toString() + ' ' + sizes[i];
}

/**
 * This is a copy of the normalizeString function from @vendure/common/lib/normalize-string.js
 * It is duplicated here due to issues importing from that package
 * inside the monorepo.
 */
export function normalizeString(input: string, spaceReplacer = ' '): string {
    const multipleSequentialReplacerRegex = new RegExp(`([${spaceReplacer}]){2,}`, 'g');

    return (input || '')
        .normalize('NFD')
        .replace(/[\u00df]/g, 'ss')
        .replace(/[\u1e9e]/g, 'SS')
        .replace(/[\u0308]/g, 'e')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[!"£$%^&*()+[\]{};:@#~?\\/,|><`¬'=‘’©®™]/g, '')
        .replace(/\s+/g, spaceReplacer)
        .replace(multipleSequentialReplacerRegex, spaceReplacer);
}

/**
 * Removes any readonly custom fields from form values before submission.
 * Also removes localeString and localeText fields from the root customFields object
 * since they should only exist in the translations array.
 * Additionally removes any custom fields that are not present in the provided config,
 * which handles fields the user does not have permission to update.
 * This prevents errors when submitting readonly or permission-restricted custom field values to mutations.
 *
 * @param values - The form values that may contain custom fields
 * @param customFieldConfigs - Array of custom field configurations for the entity
 *   (should already be filtered to only include fields the current user has access to)
 * @returns The values with readonly, locale, and non-permitted custom fields removed
 */
export function removeReadonlyAndLocalizedCustomFields<T extends Record<string, any>>(
    values: T,
    customFieldConfigs: Array<{ name: string; readonly?: boolean | null; type?: string }> = [],
): T {
    if (!values) {
        return values;
    }

    const result = structuredClone(values);
    const permittedFieldNames = new Set(
        customFieldConfigs.flatMap(config => {
            if (config.type === 'relation') {
                // Relation fields are transformed to `nameId` or `nameIds` by
                // transformRelationFields() before this function runs
                return [config.name, `${config.name}Id`, `${config.name}Ids`];
            }
            return [config.name];
        }),
    );
    const readonlyFieldNames = customFieldConfigs.flatMap(config => {
        if (config.readonly !== true) return [];
        if (config.type === 'relation') {
            return [config.name, `${config.name}Id`, `${config.name}Ids`];
        }
        return [config.name];
    });
    const localeFieldNames = customFieldConfigs
        .filter(config => config.type === 'localeString' || config.type === 'localeText')
        .map(config => config.name);
    const fieldsToRemoveFromRoot = [...readonlyFieldNames, ...localeFieldNames];

    if (result.customFields && typeof result.customFields === 'object') {
        for (const fieldName of Object.keys(result.customFields)) {
            if (!permittedFieldNames.has(fieldName)) {
                delete result.customFields[fieldName];
            }
        }
        fieldsToRemoveFromRoot.forEach(fieldName => {
            delete result.customFields[fieldName];
        });
    }

    removeNonPermittedAndReadonlyFromTranslations(result, readonlyFieldNames, permittedFieldNames);
    return result;
}

function removeNonPermittedAndReadonlyFromTranslations(
    entity: Record<string, any>,
    readonlyFieldNames: string[],
    permittedFieldNames: Set<string>,
): void {
    if (!Array.isArray(entity.translations)) {
        return;
    }

    entity.translations.forEach((translation: Record<string, any>) => {
        if (translation?.customFields && typeof translation.customFields === 'object') {
            for (const fieldName of Object.keys(translation.customFields)) {
                if (!permittedFieldNames.has(fieldName)) {
                    delete translation.customFields[fieldName];
                }
            }
            readonlyFieldNames.forEach(fieldName => {
                delete translation.customFields[fieldName];
            });
        }
    });
}
