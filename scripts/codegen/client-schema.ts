import { makeExecutableSchema } from '@graphql-tools/schema';
import fs from 'fs';
import path from 'path';

const CLIENT_SCHEMA_FILE = '../../packages/admin-ui/src/lib/core/src/data/client-state/client-types.graphql';
const LANGUAGE_CODE_FILE = '../../packages/core/src/api/schema/common/language-code.graphql';
const AUTH_TYPE_FILE = '../../packages/core/src/api/schema/common/auth.type.graphql';

function loadGraphQL(file: string): string {
    const filePath = path.join(__dirname, file);
    return fs.readFileSync(filePath, 'utf8');
}

/**
 * Augments the client schema (used by apollo-link-state) with missing
 * definitions, to allow the codegen step to work correctly.
 * See: https://github.com/dotansimha/graphql-code-generator/issues/583
 */
function getClientSchema() {
    const clientDirective = `
        directive @client on FIELD
    `;
    const clientSchemaString = loadGraphQL(CLIENT_SCHEMA_FILE);
    const languageCodeString = loadGraphQL(LANGUAGE_CODE_FILE);
    const authTypeString = loadGraphQL(AUTH_TYPE_FILE);
    const permissionTypeString = `enum Permission { Placeholder }`;
    const schema = makeExecutableSchema({
        typeDefs: [
            clientSchemaString,
            clientDirective,
            languageCodeString,
            authTypeString,
            permissionTypeString,
        ],
    });
    return schema;
}

export default getClientSchema();
