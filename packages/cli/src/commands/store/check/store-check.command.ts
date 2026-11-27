import { defineCommand } from '@vendure/common/lib/command';

import { localAdminApiErrorList } from '../../../shared/local-admin-api.js';
import { devServerErrors } from '../../devserver/devserver.js';

import { storeCheckErrors } from './store-check.errors.js';

// Not an MCP tool: the McpPlugin has `check_store`, which runs the same check on the server.
export const storeCheckDefinition = defineCommand({
    path: ['store', 'check'],
    description: 'Check whether each channel of the running dev server can take an order',
    keywords: ['readiness', 'setup', 'tax', 'shipping', 'payment', 'onboarding'],
    behavior: 'readonly',
    expose: { mcp: false },
    schemas: () => import('./store-check.schema.js'),
    errors: [
        devServerErrors.projectNotFound,
        devServerErrors.stateFileUnavailable,
        ...localAdminApiErrorList,
        storeCheckErrors.notAuthorized,
        storeCheckErrors.notSupported,
        storeCheckErrors.queryFailed,
    ],
    examples: ['vendure store check', 'vendure store check --json'],
    run: () => import('./store-check.run.js'),
    render: () => import('./store-check.render.js'),
});
