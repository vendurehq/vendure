import { DocumentNode, getOperationAST, NamedTypeNode, TypeNode } from 'graphql';

const CREATE_ENTITY_REGEX = /Create([A-Za-z]+)Input/;
const UPDATE_ENTITY_REGEX = /Update([A-Za-z]+)Input/;

/**
 * Checks the current documentNode for an operation with a variable named "Create<Entity>Input" or "Update<Entity>Input"
 * and if a match is found, returns the <Entity> name.
 */
export function isEntityCreateOrUpdateMutation(documentNode: DocumentNode): string | undefined {
    const operationDef = getOperationAST(documentNode, null);
    if (operationDef && operationDef.variableDefinitions) {
        for (const variableDef of operationDef.variableDefinitions) {
            const namedType = extractInputType(variableDef.type);
            const inputTypeName = namedType.name.value;

            // special cases which don't follow the usual pattern
            if (inputTypeName === 'UpdateActiveAdministratorInput') {
                return 'Administrator';
            }
            if (inputTypeName === 'ModifyOrderInput') {
                return 'Order';
            }
            if (
                inputTypeName === 'AddItemToDraftOrderInput' ||
                inputTypeName === 'AdjustDraftOrderLineInput'
            ) {
                return 'OrderLine';
            }

            const createMatch = inputTypeName.match(CREATE_ENTITY_REGEX);
            if (createMatch) {
                return createMatch[1];
            }
            const updateMatch = inputTypeName.match(UPDATE_ENTITY_REGEX);
            if (updateMatch) {
                return updateMatch[1];
            }
        }
    }
}

function extractInputType(type: TypeNode): NamedTypeNode {
    if (type.kind === 'NonNullType') {
        return extractInputType(type.type);
    }
    if (type.kind === 'ListType') {
        return extractInputType(type.type);
    }
    return type;
}
