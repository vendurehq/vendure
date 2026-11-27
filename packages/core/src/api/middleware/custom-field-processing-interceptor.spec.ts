import { CallHandler, ExecutionContext } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { LanguageCode } from '@vendure/common/lib/generated-types';
import { buildSchema, GraphQLSchema, OperationTypeNode } from 'graphql';
import { describe, expect, it } from 'vitest';

import { ConfigService } from '../../config/config.service';
import { CustomFieldConfig } from '../../config/custom-field/custom-field-types';
import { Channel } from '../../entity/channel/channel.entity';
import { internal_setRequestContext, RequestContext } from '../common/request-context';

import {
    CustomFieldProcessingInterceptor,
    isStoredCustomFieldValue,
} from './custom-field-processing-interceptor';

describe('isStoredCustomFieldValue()', () => {
    const field = (config: Partial<CustomFieldConfig>) => ({ name: 'field', ...config }) as CustomFieldConfig;

    it('compares a relation by id', () => {
        const relation = field({ type: 'relation' });

        expect(isStoredCustomFieldValue(relation, '2', { id: 2 })).toBe(true);
        expect(isStoredCustomFieldValue(relation, '3', { id: 2 })).toBe(false);
        expect(isStoredCustomFieldValue(relation, null, null)).toBe(true);
        expect(isStoredCustomFieldValue(relation, null, { id: 2 })).toBe(false);
        expect(isStoredCustomFieldValue(relation, '2', null)).toBe(false);
    });

    it('compares a list relation by ids, in any order', () => {
        const relation = field({ type: 'relation', list: true });

        expect(isStoredCustomFieldValue(relation, ['2', '1'], [{ id: 1 }, { id: 2 }])).toBe(true);
        expect(isStoredCustomFieldValue(relation, ['1'], [{ id: 1 }, { id: 2 }])).toBe(false);
        expect(isStoredCustomFieldValue(relation, [], null)).toBe(true);
    });

    it('treats a stored 0 or 1 as a boolean', () => {
        const boolean = field({ type: 'boolean' });

        expect(isStoredCustomFieldValue(boolean, false, 0)).toBe(true);
        expect(isStoredCustomFieldValue(boolean, true, 1)).toBe(true);
        expect(isStoredCustomFieldValue(boolean, true, 0)).toBe(false);
    });

    it('compares a struct without regard to key order', () => {
        const struct = field({ type: 'struct', fields: [] } as any);

        expect(isStoredCustomFieldValue(struct, { long: 'a', b: 'b' }, { b: 'b', long: 'a' })).toBe(true);
        expect(isStoredCustomFieldValue(struct, { long: 'a', b: 'b' }, { b: 'c', long: 'a' })).toBe(false);
    });

    it('compares a datetime by instant', () => {
        const datetime = field({ type: 'datetime' });
        const date = new Date('2026-01-01T10:00:00.000Z');

        expect(isStoredCustomFieldValue(datetime, new Date(date), date)).toBe(true);
        expect(isStoredCustomFieldValue(datetime, new Date('2026-01-02T10:00:00.000Z'), date)).toBe(false);
    });

    it('treats undefined and null as equal', () => {
        const string = field({ type: 'string' });

        expect(isStoredCustomFieldValue(string, null, undefined)).toBe(true);
        expect(isStoredCustomFieldValue(string, 'a', null)).toBe(false);
    });
});

describe('CustomFieldProcessingInterceptor with the buyerPrice queries', () => {
    const schema = buildSchema(`
        input OrderLineCustomFieldsInput {
            unitCode: String
            note: String
            stamp: String
        }
        input BuyerPriceInput {
            productVariantId: ID!
            customFields: OrderLineCustomFieldsInput
        }
        type Query {
            buyerPrice(productVariantId: ID!, customFields: OrderLineCustomFieldsInput): Int
            buyerPrices(input: [BuyerPriceInput!]!): [Int]!
            otherQuery(customFields: OrderLineCustomFieldsInput): Int
        }
    `);
    const orderLineConfig = [
        { name: 'unitCode', type: 'string', defaultValue: 'BOX', pattern: '^[A-Z]+$' },
        { name: 'note', type: 'string' },
        { name: 'stamp', type: 'string', readonly: true, defaultValue: 'STAMP' },
        { name: 'internalCode', type: 'string', internal: true, defaultValue: 'INTERNAL' },
    ] as CustomFieldConfig[];
    const createInterceptor = (config: CustomFieldConfig[], dbType = 'sqljs') =>
        new CustomFieldProcessingInterceptor(
            {
                customFields: { OrderLine: config },
                apiOptions: { shopListQueryLimit: 3 },
                dbConnectionOptions: { type: dbType },
            } as unknown as ConfigService,
            {} as ModuleRef,
        );
    const interceptor = createInterceptor(orderLineConfig);
    const next: CallHandler = { handle: () => undefined as any };
    const resolver = () => undefined;

    async function runQuery(
        fieldName: string,
        args: Record<string, any>,
        options: { interceptor?: CustomFieldProcessingInterceptor; schema?: GraphQLSchema } = {},
    ) {
        const req = {} as any;
        internal_setRequestContext(
            req,
            new RequestContext({
                apiType: 'shop',
                channel: new Channel(),
                authorizedAsOwnerOnly: false,
                languageCode: LanguageCode.en,
                isAuthorized: true,
            }),
        );
        const info = {
            operation: { operation: OperationTypeNode.QUERY },
            schema: options.schema ?? schema,
            fieldName,
        };
        const resolverArgs = [{}, args, { req }, info];
        const context = {
            getType: () => 'graphql',
            getArgs: () => resolverArgs,
            getArgByIndex: (index: number) => resolverArgs[index],
            getClass: () => Object,
            getHandler: () => resolver,
        } as unknown as ExecutionContext;
        await (options.interceptor ?? interceptor).intercept(context, next);
        return args;
    }

    it('gives buyerPrice the defaults when the input leaves out the fields or the customFields argument', async () => {
        expect(await runQuery('buyerPrice', { productVariantId: '1' })).toEqual({
            productVariantId: '1',
            customFields: { unitCode: 'BOX', stamp: 'STAMP', internalCode: 'INTERNAL' },
        });
        expect(await runQuery('buyerPrice', { productVariantId: '1', customFields: { note: 'a' } })).toEqual({
            productVariantId: '1',
            customFields: { unitCode: 'BOX', note: 'a', stamp: 'STAMP', internalCode: 'INTERNAL' },
        });
    });

    it('gives each buyerPrices input the defaults, also for a field set to null', async () => {
        const args = await runQuery('buyerPrices', {
            input: [
                { productVariantId: '1' },
                { productVariantId: '2', customFields: { unitCode: null, note: null } },
                { productVariantId: '3', customFields: { unitCode: 'PIECE' } },
            ],
        });

        expect(args.input.map((input: any) => input.customFields)).toEqual([
            { unitCode: 'BOX', stamp: 'STAMP', internalCode: 'INTERNAL' },
            { unitCode: 'BOX', note: null, stamp: 'STAMP', internalCode: 'INTERNAL' },
            { unitCode: 'PIECE', stamp: 'STAMP', internalCode: 'INTERNAL' },
        ]);
    });

    it('validates the custom fields as for addItemToOrder', async () => {
        await expect(
            runQuery('buyerPrices', {
                input: [{ productVariantId: '1', customFields: { unitCode: 'box' } }],
            }),
        ).rejects.toThrow('error.field-invalid-string-pattern');
        await expect(
            runQuery('buyerPrice', { productVariantId: '1', customFields: { stamp: 'OTHER' } }),
        ).rejects.toThrow('error.field-invalid-readonly');
    });

    it('does not change the arguments of another query', async () => {
        expect(await runQuery('otherQuery', { customFields: { unitCode: null } })).toEqual({
            customFields: { unitCode: null },
        });
    });

    it('checks the buyerPrices limit before it validates the custom fields', async () => {
        const input = [1, 2, 3, 4].map(id => ({ productVariantId: id, customFields: { unitCode: 'box' } }));

        await expect(runQuery('buyerPrices', { input })).rejects.toThrow('error.list-query-limit-exceeded');
    });

    it('does not add a list default for which MySQL stores no column default', async () => {
        const config = [
            { name: 'unitCode', type: 'string', defaultValue: 'BOX' },
            { name: 'codes', type: 'string', list: true, defaultValue: ['A'] },
        ] as CustomFieldConfig[];
        const run = (dbType: string) =>
            runQuery(
                'buyerPrice',
                { productVariantId: '1' },
                { interceptor: createInterceptor(config, dbType) },
            );

        expect((await run('mysql')).customFields).toEqual({ unitCode: 'BOX' });
        expect((await run('mariadb')).customFields).toEqual({ unitCode: 'BOX', codes: ['A'] });
    });

    it('adds the defaults when the Shop API has no OrderLine custom fields input', async () => {
        const schemaWithoutInput = buildSchema(`
            input BuyerPriceInput {
                productVariantId: ID!
            }
            type Query {
                buyerPrice(productVariantId: ID!): Int
                buyerPrices(input: [BuyerPriceInput!]!): [Int]!
            }
        `);
        const config = [
            { name: 'unitCode', type: 'string', public: false, defaultValue: 'BOX' },
        ] as CustomFieldConfig[];
        const options = { interceptor: createInterceptor(config), schema: schemaWithoutInput };

        expect(await runQuery('buyerPrice', { productVariantId: '1' }, options)).toEqual({
            productVariantId: '1',
            customFields: { unitCode: 'BOX' },
        });
        const args = await runQuery('buyerPrices', { input: [{ productVariantId: '1' }] }, options);
        expect(args.input).toEqual([{ productVariantId: '1', customFields: { unitCode: 'BOX' } }]);
    });
});
