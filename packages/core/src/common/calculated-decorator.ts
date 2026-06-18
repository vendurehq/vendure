import { OrderByCondition, SelectQueryBuilder } from 'typeorm';

/**
 * The property name we use to store the CalculatedColumnDefinitions to the
 * entity class.
 */
export const CALCULATED_PROPERTIES = '__calculatedProperties__';

/**
 * @description
 * Optional metadata used to tell the {@link ListQueryBuilder} & {@link Relations} decorator how to deal with
 * calculated columns when sorting, filtering and deriving required relations from GraphQL operations.
 *
 * @docsCategory data-access
 * @docsPage Calculated
 */
export interface CalculatedColumnQueryInstruction {
    /**
     * @description
     * If the calculated property depends on one or more relations being present
     * on the entity (e.g. an `Order` entity calculating the `totalQuantity` by adding
     * up the quantities of each `OrderLine`), then those relations should be defined here.
     */
    relations?: string[];
    query?: (qb: SelectQueryBuilder<any>) => void;
    expression?: string;
}

export interface CalculatedColumnDefinition {
    name: string | symbol;
    listQuery?: CalculatedColumnQueryInstruction;
}

/**
 * @description
 * Used to define calculated entity getters. The decorator simply attaches an array of "calculated"
 * property names to the entity's prototype. This array is then used by the {@link CalculatedPropertySubscriber}
 * to transfer the getter function from the prototype to the entity instance.
 *
 * @docsCategory data-access
 * @docsWeight 0
 */
export function Calculated(queryInstruction?: CalculatedColumnQueryInstruction): MethodDecorator {
    return (
        target: object & { [key: string]: any },
        propertyKey: string | symbol,
        descriptor: PropertyDescriptor,
    ) => {
        const definition: CalculatedColumnDefinition = {
            name: propertyKey,
            listQuery: queryInstruction,
        };
        if (target[CALCULATED_PROPERTIES]) {
            if (
                !target[CALCULATED_PROPERTIES].map((p: CalculatedColumnDefinition) => p.name).includes(
                    definition.name,
                )
            ) {
                target[CALCULATED_PROPERTIES].push(definition);
            }
        } else {
            target[CALCULATED_PROPERTIES] = [definition];
        }
    };
}
