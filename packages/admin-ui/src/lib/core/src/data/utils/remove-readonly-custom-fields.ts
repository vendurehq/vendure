import { CustomFieldConfig } from '../../common/generated-types';

type InputWithOptionalCustomFields = Record<string, any> & {
    customFields?: Record<string, any>;
};

type EntityInput = InputWithOptionalCustomFields & {
    translations?: InputWithOptionalCustomFields[];
};

type Variable = EntityInput | EntityInput[];

type WrappedVariable = {
    input: Variable;
};

/**
 * Removes any `readonly` custom fields from an entity (including its translations).
 * To be used before submitting the entity for a create or update request.
 */
export function removeReadonlyCustomFields(
    variables: Variable | WrappedVariable | WrappedVariable[],
    customFieldConfig: CustomFieldConfig[],
) {
    if (Array.isArray(variables)) {
        return variables.map(variable => removeReadonlyCustomFields(variable, customFieldConfig));
    }

    if ('input' in variables && variables.input) {
        if (Array.isArray(variables.input)) {
            variables.input = variables.input.map(variable => removeReadonly(variable, customFieldConfig));
        } else {
            variables.input = removeReadonly(variables.input, customFieldConfig);
        }
        return variables;
    }

    return removeReadonly(variables, customFieldConfig);
}

function removeReadonly(input: EntityInput, customFieldConfig: CustomFieldConfig[]) {
    const readonlyConfigs = customFieldConfig.filter(({ readonly }) => readonly);

    readonlyConfigs.forEach(({ name }) => {
        input.translations?.forEach(translation => {
            delete translation.customFields?.[name];
        });

        delete input.customFields?.[name];
    });

    return input;
}
