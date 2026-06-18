import { pick } from '@vendure/common/lib/pick';
import {
    defaultShippingEligibilityChecker,
    LanguageCode,
    mergeConfig,
    ShippingEligibilityChecker,
} from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { getCheckersDocument, updateShippingMethodDocument } from './graphql/shared-definitions';
import { assertThrowsWithMessage } from './utils/assert-throws-with-message';

const testShippingEligibilityChecker = new ShippingEligibilityChecker({
    code: 'test-checker',
    description: [{ languageCode: LanguageCode.en, value: 'test checker' }],
    args: {
        optional: {
            label: [
                { languageCode: LanguageCode.en, value: 'Optional argument' },
                { languageCode: LanguageCode.de, value: 'Optional eingabe' },
            ],
            description: [
                { languageCode: LanguageCode.en, value: 'This is an optional argument' },
                { languageCode: LanguageCode.de, value: 'Das ist eine optionale eingabe' },
            ],
            required: false,
            type: 'string',
        },
        required: {
            required: true,
            type: 'string',
            defaultValue: 'hello',
        },
    },
    check: ctx => true,
});

describe('Configurable operations', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            shippingOptions: {
                shippingEligibilityCheckers: [
                    defaultShippingEligibilityChecker,
                    testShippingEligibilityChecker,
                ],
            },
        }),
    );

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-full.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    describe('required args', () => {
        it('allows empty optional arg', async () => {
            const { updateShippingMethod } = await adminClient.query(updateShippingMethodDocument, {
                input: {
                    id: 'T_1',
                    checker: {
                        code: testShippingEligibilityChecker.code,
                        arguments: [
                            { name: 'optional', value: '' },
                            { name: 'required', value: 'foo' },
                        ],
                    },
                    translations: [],
                },
            });

            expect(updateShippingMethod.checker.args).toEqual([
                {
                    name: 'optional',
                    value: '',
                },
                {
                    name: 'required',
                    value: 'foo',
                },
            ]);
        });

        it(
            'throws if a required arg is null',
            assertThrowsWithMessage(async () => {
                await adminClient.query(updateShippingMethodDocument, {
                    input: {
                        id: 'T_1',
                        checker: {
                            code: testShippingEligibilityChecker.code,
                            arguments: [
                                { name: 'optional', value: 'null' },
                                { name: 'required', value: '' },
                            ],
                        },
                        translations: [],
                    },
                });
            }, 'The argument "required" is required'),
        );
    });

    it('defaultValue', async () => {
        const { shippingEligibilityCheckers } = await adminClient.query(getCheckersDocument);
        expect(shippingEligibilityCheckers[1].args.map(pick(['name', 'defaultValue']))).toEqual([
            { name: 'optional', defaultValue: null },
            { name: 'required', defaultValue: 'hello' },
        ]);
    });
});
