import { buildSchema, extendSchema, GraphQLSchema, parse } from 'graphql';

export const ERROR_INTERFACE_NAME = 'ErrorResult';

/**
 * Generates the members of the `ErrorCode` enum dynamically, by getting the names of
 * all the types which inherit from the `ErrorResult` interface.
 */
export function generateErrorCodeEnum(typeDefsOrSchema: string | GraphQLSchema): GraphQLSchema {
    const schema = typeof typeDefsOrSchema === 'string' ? buildSchema(typeDefsOrSchema) : typeDefsOrSchema;
    const errorNodes = Object.values(schema.getTypeMap())
        .map(type => type.astNode)
        .filter(node => {
            return (
                node &&
                node?.kind === 'ObjectTypeDefinition' &&
                node.interfaces?.map(i => i.name.value).includes(ERROR_INTERFACE_NAME)
            );
        });
    if (!errorNodes.length) {
        return schema;
    }

    const errorCodeEnum = `
        extend enum ErrorCode {
            ${errorNodes.map(n => camelToUpperSnakeCase(n?.name.value || '')).join('\n')}
        }`;
    return extendSchema(schema, parse(errorCodeEnum));
}

function camelToUpperSnakeCase(input: string): string {
    return input.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase();
}
