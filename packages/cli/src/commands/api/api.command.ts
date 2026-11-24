import { defineCommand } from '@vendure/common/lib/command';

import { localAdminApiErrorList } from '../../shared/local-admin-api.js';
import { devServerErrors } from '../devserver/devserver.js';

import { apiErrors } from './api.errors.js';

// `mutating` with no named consent: any GraphQL document can mutate, and the host cannot tell a
// query from a mutation, but the local store is a development database.
export const apiDefinition = defineCommand({
    path: ['api'],
    description:
        'Run a GraphQL operation on the local dev server: on the Admin API as the superadmin, or on the Shop API anonymously',
    keywords: ['graphql', 'query', 'mutation', 'admin', 'shop', 'replay', 'request', 'debug'],
    behavior: 'mutating',
    schemas: () => import('./api.schema.js'),
    cli: { positional: ['target', 'query'] },
    errors: [
        devServerErrors.projectNotFound,
        devServerErrors.stateFileUnavailable,
        apiErrors.invalidVariables,
        ...localAdminApiErrorList,
    ],
    examples: [
        "vendure api admin '{ products(options: { take: 5 }) { items { id name } } }'",
        'vendure api shop \'query ($id: ID!) { product(id: $id) { name } }\' --variables \'{"id":"1"}\' --json',
    ],
    run: () => import('./api.js'),
    render: () => import('./api.js'),
});
