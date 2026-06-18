import { CustomFieldType } from '@vendure/common/lib/shared-types';
import { assertNever } from '@vendure/common/lib/shared-utils';
import { CustomFieldConfig } from '../generated-types';

export function getCustomFieldsDefaults(customFieldConfig: CustomFieldConfig[]): {
    [key: string]: ReturnType<typeof getDefaultValue>;
} {
    return customFieldConfig.reduce(
        (hash, field) => ({
            ...hash,
            [field.name]: getDefaultValue(field.type as CustomFieldType, field.nullable ?? undefined),
        }),
        {},
    );
}

export function getDefaultValue(type: CustomFieldType, isNullable?: boolean) {
    switch (type) {
        case 'localeString':
        case 'string':
        case 'text':
        case 'localeText':
            return isNullable ? null : '';
        case 'boolean':
            return isNullable ? null : false;
        case 'float':
        case 'int':
            return isNullable ? null : 0;
        case 'datetime':
            return isNullable ? null : new Date();
        case 'relation':
            return null;
        case 'struct':
            return {};
        default:
            assertNever(type);
    }
}
