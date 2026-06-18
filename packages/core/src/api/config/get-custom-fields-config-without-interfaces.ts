import { GraphQLSchema, isInterfaceType } from 'graphql';

import { CustomFieldConfig, CustomFields } from '../../config/custom-field/custom-field-types';

/**
 * @description
 * Because the "Region" entity is an interface, it cannot be extended directly, so we need to
 * replace it if found in the custom field config with its concrete implementations.
 *
 * Same goes for the "StockMovement" entity.
 */
export function getCustomFieldsConfigWithoutInterfaces(
    customFieldConfig: CustomFields,
    schema: GraphQLSchema,
): Array<[entityName: string, config: CustomFieldConfig[]]> {
    const entries = Object.entries(customFieldConfig);
    const interfaceEntities = ['Region', 'StockMovement'];
    for (const entityName of interfaceEntities) {
        const index = entries.findIndex(([name]) => name === entityName);
        if (index !== -1) {
            // An interface type such as Region or StockMovement cannot directly be extended.
            // Instead, we will use the concrete types that implement it.
            const interfaceType = schema.getType(entityName);
            if (isInterfaceType(interfaceType)) {
                const implementations = schema.getImplementations(interfaceType);
                // Remove the interface from the list of entities to which custom fields can be added
                entries.splice(index, 1);

                for (const implementation of implementations.objects) {
                    entries.push([implementation.name, customFieldConfig[entityName] ?? []]);
                }
            }
        }
    }
    return entries;
}
