import type { VendureConfig } from '@vendure/core';

import type packageMetadata from './package.json';
import { type name } from './package.json';

export { type version } from './package.json';

export const config: VendureConfig = {
    apiOptions: { port: 3000 },
    authOptions: { tokenMethod: 'bearer' },
    dbConnectionOptions: { type: 'postgres' },
    paymentOptions: { paymentMethodHandlers: [] },
    plugins: [],
};

export type FixturePackageMetadata = typeof packageMetadata & { name: typeof name };
