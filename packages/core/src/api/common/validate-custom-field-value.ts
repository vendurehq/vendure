import { assertNever } from '@vendure/common/lib/shared-utils';

import { UserInputError } from '../../common/error/errors';
import { Injector } from '../../common/injector';
import {
    CustomFieldConfig,
    DateTimeCustomFieldConfig,
    FloatCustomFieldConfig,
    IntCustomFieldConfig,
    LocaleStringCustomFieldConfig,
    StringCustomFieldConfig,
    StringStructFieldConfig,
    StructCustomFieldConfig,
    StructFieldConfig,
    TypedCustomFieldConfig,
    TypedStructFieldConfig,
} from '../../config/custom-field/custom-field-types';

import { RequestContext } from './request-context';
import { userHasPermissionsOnCustomField } from './user-has-permissions-on-custom-field';

/**
 * Validates the value of a custom field input against any configured constraints.
 * If validation fails, an error is thrown.
 */
export async function validateCustomFieldValue(
    config: CustomFieldConfig,
    value: any | any[],
    injector: Injector,
    ctx: RequestContext,
): Promise<void> {
    if (config.readonly) {
        throw new UserInputError('error.field-invalid-readonly', { name: config.name });
    }
    if (config.nullable === false) {
        if (value === null) {
            throw new UserInputError('error.field-invalid-non-nullable', {
                name: config.name,
            });
        }
    }
    if (config.requiresPermission) {
        if (!userHasPermissionsOnCustomField(ctx, config)) {
            throw new UserInputError('error.field-invalid-no-permission', { name: config.name });
        }
    }
    if (config.list === true && Array.isArray(value)) {
        for (const singleValue of value) {
            validateSingleValue(config, singleValue);
            if (config.type === 'struct') {
                await validateStructField(config, singleValue, injector, ctx);
            }
        }
    } else {
        validateSingleValue(config, value);
        if (config.type === 'struct') {
            await validateStructField(config, value, injector, ctx);
        }
    }
    await validateCustomFunction(config as TypedCustomFieldConfig<any, any>, value, injector, ctx);
}

function validateSingleValue(config: CustomFieldConfig | StructFieldConfig, value: any) {
    switch (config.type) {
        case 'string':
        case 'localeString':
            validateStringField(config, value);
            break;
        case 'int':
        case 'float':
            validateNumberField(config, value);
            break;
        case 'datetime':
            validateDateTimeField(config, value);
            break;
        case 'boolean':
        case 'relation':
        case 'text':
        case 'localeText':
            break;
        // Structs get validated separately
        case 'struct':
            break;
        default:
            assertNever(config);
    }
}

async function validateStructField(
    config: StructCustomFieldConfig,
    value: any,
    injector: Injector,
    ctx: RequestContext,
) {
    for (const field of config.fields ?? []) {
        const fieldValue = value[field.name];
        if (fieldValue !== undefined) {
            validateSingleValue(field, fieldValue);
        }
        if (typeof field.validate === 'function') {
            const error = await (field.validate as any)(fieldValue, injector, ctx);
            if (typeof error === 'string') {
                throw new UserInputError(error);
            }
            if (Array.isArray(error)) {
                const localizedError = error.find(e => e.languageCode === ctx.languageCode) || error[0];
                throw new UserInputError(localizedError.value);
            }
        }
    }
}

async function validateCustomFunction<
    T extends TypedCustomFieldConfig<any, any> | TypedStructFieldConfig<any, any>,
>(config: T, value: any, injector: Injector, ctx: RequestContext) {
    if (typeof config.validate === 'function') {
        const error = await config.validate(value, injector, ctx);
        if (typeof error === 'string') {
            throw new UserInputError(error);
        }
        if (Array.isArray(error)) {
            const localizedError = error.find(e => e.languageCode === ctx.languageCode) || error[0];
            throw new UserInputError(localizedError.value);
        }
    }
}

function validateStringField(
    config: StringCustomFieldConfig | LocaleStringCustomFieldConfig | StringStructFieldConfig,
    value: string,
): void {
    const { pattern } = config;
    if (pattern && value != null) {
        const re = new RegExp(pattern);
        if (!re.test(value)) {
            throw new UserInputError('error.field-invalid-string-pattern', {
                name: config.name,
                value,
                pattern,
            });
        }
    }
    const options = (config as StringCustomFieldConfig).options;
    if (options) {
        const validOptions = options.map(o => o.value);
        if (value === null && (config as StringCustomFieldConfig).nullable !== false) {
            return;
        }
        if (!validOptions.includes(value)) {
            throw new UserInputError('error.field-invalid-string-option', {
                name: config.name,
                value,
                validOptions: validOptions.map(o => `'${o}'`).join(', '),
            });
        }
    }
}

function validateNumberField(config: IntCustomFieldConfig | FloatCustomFieldConfig, value: number): void {
    const { min, max } = config;
    if (min != null && value != null && value < min) {
        throw new UserInputError('error.field-invalid-number-range-min', { name: config.name, value, min });
    }
    if (max != null && value != null && max < value) {
        throw new UserInputError('error.field-invalid-number-range-max', { name: config.name, value, max });
    }
}

function validateDateTimeField(config: DateTimeCustomFieldConfig, value: string): void {
    const { min, max } = config;
    const valueDate = new Date(value);
    if (min != null && value != null && valueDate < new Date(min)) {
        throw new UserInputError('error.field-invalid-datetime-range-min', {
            name: config.name,
            value: valueDate.toISOString(),
            min,
        });
    }
    if (max != null && value != null && new Date(max) < valueDate) {
        throw new UserInputError('error.field-invalid-datetime-range-max', {
            name: config.name,
            value: valueDate.toISOString(),
            max,
        });
    }
}
