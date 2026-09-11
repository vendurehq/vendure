import { VendureConfig } from '@vendure/core';

// #5330 — this import already has the attribute, so the esm emit must not add a
// second one. TypeScript flags it here only because this fixture targets CommonJS.
import attributedData from './attributed-data.json' with { type: 'json' };
import configData from './config-data.json';
import { MyPlugin } from './my-plugin/src/my.plugin.js';

// #5330 — a re-export of JSON needs the attribute in esm mode as much as an import does.
export { default as reexportedData } from './reexported-data.json';

export const attributedLabel = attributedData.label;

export const config: VendureConfig = {
    apiOptions: { port: 3000 },
    authOptions: { tokenMethod: 'bearer' },
    dbConnectionOptions: { type: 'postgres' },
    paymentOptions: { paymentMethodHandlers: [] },
    plugins: [MyPlugin],
    customFields: { Product: [{ name: configData.foo, type: 'string' }] },
};
