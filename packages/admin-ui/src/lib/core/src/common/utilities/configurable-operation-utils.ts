import { ConfigArgType } from '@vendure/common/lib/shared-types';
import { assertNever } from '@vendure/common/lib/shared-utils';

import {
    ConfigArgDefinition,
    ConfigurableOperation,
    ConfigurableOperationDefinition,
    ConfigurableOperationInput,
} from '../generated-types';

/**
 * ConfigArg values are always stored as strings. If they are not primitives, then
 * they are JSON-encoded. This function unwraps them back into their original
 * data type.
 */
export function getConfigArgValue(value: any) {
    try {
        const result = value != null ? JSON.parse(value) : undefined;
        if (result && typeof result === 'object' && !Array.isArray(result)) {
            // There is an edge-case where the value is a valid JSON-encoded string and
            // will get parsed as an object, but we actually want it to be a string.
            return JSON.stringify(result);
        } else {
            return result;
        }
    } catch (e: any) {
        return value;
    }
}

export function encodeConfigArgValue(value: any): string {
    return Array.isArray(value) ? JSON.stringify(value) : (value ?? '').toString();
}

/**
 * Creates an empty ConfigurableOperation object based on the definition.
 */
export function configurableDefinitionToInstance(
    def: Omit<ConfigurableOperationDefinition, '__typename'>,
): ConfigurableOperation {
    return {
        ...def,
        args: def.args.map(arg => ({
            ...arg,
            value: getDefaultConfigArgValue(arg),
        })),
    } as ConfigurableOperation;
}

/**
 * Converts an object of the type:
 * ```
 * {
 *     code: 'my-operation',
 *     args: {
 *         someProperty: 'foo'
 *     }
 * }
 * ```
 * to the format defined by the ConfigurableOperationInput GraphQL input type:
 * ```
 * {
 *     code: 'my-operation',
 *     arguments: [
 *         { name: 'someProperty', value: 'foo' }
 *     ]
 * }
 * ```
 */
export function toConfigurableOperationInput(
    operation: Omit<ConfigurableOperation, '__typename'>,
    formValueOperations: { args: Record<string, string> | Array<{ name: string; value: string }> },
): ConfigurableOperationInput {
    const argsArray = Array.isArray(formValueOperations.args) ? formValueOperations.args : undefined;
    const argsMap = !Array.isArray(formValueOperations.args) ? formValueOperations.args : undefined;
    return {
        code: operation.code,
        arguments: operation.args.map(({ name, value }, j) => {
            const formValue = argsArray?.find(arg => arg.name === name)?.value ?? argsMap?.[name];
            if (formValue == null) {
                throw new Error(`Cannot find an argument value for the key "${name}"`);
            }
            return {
                name,
                value: formValue?.hasOwnProperty('value')
                    ? encodeConfigArgValue((formValue as any).value)
                    : encodeConfigArgValue(formValue),
            };
        }),
    };
}

export function configurableOperationValueIsValid(
    def?: ConfigurableOperationDefinition,
    value?: { code: string; args: { [key: string]: string } },
) {
    if (!def || !value) {
        return false;
    }
    if (def.code !== value.code) {
        return false;
    }
    for (const argDef of def.args) {
        const argVal = value.args[argDef.name];
        if (argDef.required && (argVal == null || argVal === '' || argVal === '0')) {
            return false;
        }
    }
    return true;
}

/**
 * Returns a default value based on the type of the config arg.
 */
export function getDefaultConfigArgValue(arg: ConfigArgDefinition): any {
    if (arg.list) {
        return [];
    }
    if (arg.defaultValue != null) {
        return arg.defaultValue;
    }
    const type = arg.type as ConfigArgType;
    switch (type) {
        case 'string':
        case 'datetime':
        case 'float':
        case 'ID':
        case 'int':
            return null;
        case 'boolean':
            return false;
        default:
            assertNever(type);
    }
}
