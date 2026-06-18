import { stitchSchemas, ValidationLevel } from '@graphql-tools/stitch';
import { Mutation, Query } from '@vendure/common/lib/generated-shop-types';
import {
    buildASTSchema,
    GraphQLInputFieldConfigMap,
    GraphQLInputObjectType,
    GraphQLSchema,
    isInputObjectType,
} from 'graphql';

import { InternalServerError } from '../../common/error/errors';
import { ActiveOrderStrategy, ACTIVE_ORDER_INPUT_FIELD_NAME } from '../../config/order/active-order-strategy';

/**
 * This function is responsible for constructing the `ActiveOrderInput` GraphQL input type.
 * It does so based on the inputs defined by the configured ActiveOrderStrategy defineInputType
 * methods, dynamically building a mapped input type of the format:
 *
 *```
 * {
 *     [strategy_name]: strategy_input_type
 * }
 * ```
 */
export function generateActiveOrderTypes(
    schema: GraphQLSchema,
    activeOrderStrategies: ActiveOrderStrategy | ActiveOrderStrategy[],
): GraphQLSchema {
    const fields: GraphQLInputFieldConfigMap = {};
    const strategySchemas: GraphQLSchema[] = [];
    const strategiesArray = Array.isArray(activeOrderStrategies)
        ? activeOrderStrategies
        : [activeOrderStrategies];
    for (const strategy of strategiesArray) {
        if (typeof strategy.defineInputType === 'function') {
            const inputSchema = buildASTSchema(strategy.defineInputType());

            const inputType = Object.values(inputSchema.getTypeMap()).find(
                (type): type is GraphQLInputObjectType => isInputObjectType(type),
            );
            if (!inputType) {
                throw new InternalServerError(
                    `${strategy.constructor.name}.defineInputType() does not define a GraphQL Input type`,
                );
            }
            fields[strategy.name] = { type: inputType };
            strategySchemas.push(inputSchema);
        }
    }
    if (Object.keys(fields).length === 0) {
        return schema;
    }
    const activeOrderInput = new GraphQLInputObjectType({
        name: 'ActiveOrderInput',
        fields,
    });

    const activeOrderOperations: Array<{ name: keyof Query | keyof Mutation; isMutation: boolean }> = [
        { name: 'activeOrder', isMutation: false },
        { name: 'eligibleShippingMethods', isMutation: false },
        { name: 'eligiblePaymentMethods', isMutation: false },
        { name: 'nextOrderStates', isMutation: false },
        { name: 'addItemToOrder', isMutation: true },
        { name: 'adjustOrderLine', isMutation: true },
        { name: 'removeOrderLine', isMutation: true },
        { name: 'removeAllOrderLines', isMutation: true },
        { name: 'applyCouponCode', isMutation: true },
        { name: 'removeCouponCode', isMutation: true },
        { name: 'addPaymentToOrder', isMutation: true },
        { name: 'setCustomerForOrder', isMutation: true },
        { name: 'setOrderShippingAddress', isMutation: true },
        { name: 'setOrderBillingAddress', isMutation: true },
        { name: 'setOrderShippingMethod', isMutation: true },
        { name: 'setOrderCustomFields', isMutation: true },
        { name: 'transitionOrderToState', isMutation: true },
        { name: 'unsetOrderShippingAddress', isMutation: true },
        { name: 'unsetOrderBillingAddress', isMutation: true },
    ];

    const queryType = schema.getQueryType();
    const mutationType = schema.getMutationType();
    const strategyNames = strategiesArray.map(s => s.name).join(', ');
    const description = `Inputs for the configured ${
        strategiesArray.length === 1 ? 'ActiveOrderStrategy' : 'ActiveOrderStrategies'
    } ${strategyNames}`;
    for (const operation of activeOrderOperations) {
        const field = operation.isMutation
            ? mutationType?.getFields()[operation.name]
            : queryType?.getFields()[operation.name];
        if (!field) {
            throw new InternalServerError(
                `Could not find a GraphQL type definition for the field ${operation.name}`,
            );
        }

        // TODO: Figure out a non-hacky way to do this!
        (field.args as any).push({
            name: ACTIVE_ORDER_INPUT_FIELD_NAME,
            type: activeOrderInput,
            description,
            defaultValue: null,
            extensions: null,
            astNode: null,
            deprecationReason: null,
        });
    }

    return stitchSchemas({
        subschemas: [schema, ...strategySchemas],
        types: [activeOrderInput],
        typeMergingOptions: { validationSettings: { validationLevel: ValidationLevel.Off } },
    });
}
