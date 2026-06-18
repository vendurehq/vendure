/* eslint-disable no-console */
import fs from 'fs';
import path from 'path';

/**
 * For some unknown reason, a v1.2.2 of @vendure/core included incorrect type definitions for some types.
 * Namely, _some_ of the `ConfigurableOperationDef` types had their specific string literal & enum types
 * replaced with just `string`, which caused the published package to fail to build.
 *
 * Example:
 * [dummy-payment-method-handler.d.ts](https://unpkg.com/@vendure/core@1.2.2/dist/config/payment/dummy-payment-method-handler.d.ts)
 * ```
 * export declare const dummyPaymentHandler: PaymentMethodHandler<{
 *     automaticSettle: {
 *         type: string;
 *         label: {
 *             languageCode: any;
 *             value: string;
 *         }[];
 *         description: {
 *             languageCode: any;
 *             value: string;
 *         }[];
 *         required: true;
 *         defaultValue: boolean;
 *     };
 * }>;
 * ```
 *
 * Should be:
 * ```ts
 * export declare const dummyPaymentHandler: PaymentMethodHandler<{
 *     automaticSettle: {
 *         type: "boolean";
 *         label: {
 *             languageCode: LanguageCode.en;
 *             value: string;
 *         }[];
 *         description: {
 *             languageCode: LanguageCode.en;
 *             value: string;
 *         }[];
 *         required: true;
 *         defaultValue: false;
 *     };
 * }>;
 * ```
 *
 * This script should be run before publishing, in order to verify that this is not the case.
 */

const configPath = path.join(__dirname, '../packages/core/dist/config');
const filesToCheck = [
    path.join(configPath, 'payment/dummy-payment-method-handler.d.ts'),
    path.join(configPath, 'promotion/actions/product-percentage-discount-action.d.ts'),
    path.join(configPath, 'promotion/conditions/contains-products-condition.d.ts'),
    path.join(configPath, 'shipping-method/default-shipping-calculator.d.ts'),
    path.join(configPath, 'shipping-method/default-shipping-eligibility-checker.d.ts'),
    path.join(configPath, 'fulfillment/manual-fulfillment-handler.d.ts'),
];

console.log(`Checking core type definitions...`);
let checkIsOk = true;

for (const filePath of filesToCheck) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const matches = content.match(/type: string;|languageCode: any;/gm);
    if (matches) {
        console.warn(`\n\nBad type definitions found in file ${filePath}:`);
        console.warn(`==========`);
        console.warn(matches.join('\n'));
        console.warn(`==========`);
        checkIsOk = false;
    }
}

if (!checkIsOk) {
    process.exit(1);
} else {
    console.log(`Type defs ok!`);
    process.exit(0);
}
