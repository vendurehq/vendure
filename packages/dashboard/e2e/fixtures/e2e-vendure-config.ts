import { VendureConfig } from '@vendure/core';

import { AlertTestPlugin } from './alert-test-plugin';
import { FormInputsTestPlugin } from './form-inputs-test-plugin';

/**
 * Vendure config for the Vite plugin during E2E tests.
 *
 * This is NOT used to start a Vendure server. The dashboard's Vite plugin
 * compiles this file to discover @VendurePlugin decorators with `dashboard`
 * entry points (e.g. FormInputsTestPlugin). The dbConnectionOptions and
 * authOptions are dummy placeholders required by the VendureConfig type.
 *
 * DO NOT add customFields here. The Vite plugin generates the dashboard's
 * GraphQL schema from this config (via adminApiSchemaPlugin), and including
 * struct custom fields causes product creation mutations to fail. The
 * dashboard discovers custom fields at runtime from the backend API. Custom
 * fields belong only in global-setup.ts (via e2e-shared-config.ts).
 */
export const config: VendureConfig = {
    apiOptions: {
        port: 3000,
    },
    authOptions: {
        tokenMethod: 'bearer',
    },
    dbConnectionOptions: {
        type: 'postgres',
    },
    paymentOptions: {
        paymentMethodHandlers: [],
    },
    plugins: [FormInputsTestPlugin, AlertTestPlugin],
};
