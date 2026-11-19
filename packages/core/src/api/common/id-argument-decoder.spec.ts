import { buildSchema, GraphQLObjectType, GraphQLResolveInfo } from 'graphql';
import { describe, expect, it } from 'vitest';

import { EntityIdStrategy } from '../../config/entity/entity-id-strategy';

import { IdArgumentDecoder } from './id-argument-decoder';
import { IdCodec } from './id-codec';
import { IdCodecService } from './id-codec.service';

/**
 * Decoding a value two times gives "decoded:decoded:...", so a double decode is visible.
 */
class PrefixIdStrategy implements EntityIdStrategy<'uuid'> {
    readonly primaryKeyType = 'uuid';
    decodeId(id: string): string {
        return `decoded:${id}`;
    }
    encodeId(primaryKey: string): string {
        return primaryKey;
    }
}

const schema = buildSchema(`
    scalar DateTime
    input IDOperators {
        eq: String
        notEq: String
        in: [String!]
        notIn: [String!]
        isNull: Boolean
    }
    input ItemFilter {
        id: IDOperators
        createdAt: DateTime
        name: String
    }
    input ItemListOptions {
        filter: ItemFilter
        take: Int
    }
    type Item {
        id: ID!
        children(options: ItemListOptions): [Item!]!
    }
    type Query {
        administrators: Boolean
        item(id: ID!): Item
        job(jobId: ID!): Boolean
    }
`);

function createDecoder(transformJobIds = true) {
    const idCodec = new IdCodec(new PrefixIdStrategy());
    const idCodecService = {
        transformJobIds,
        decode: (target: any, keys?: string[]) => idCodec.decode(target, keys),
    } as unknown as IdCodecService;
    return new IdArgumentDecoder(idCodecService);
}

function infoFor(typeName: string, fieldName: string): GraphQLResolveInfo {
    return {
        schema,
        parentType: schema.getType(typeName) as GraphQLObjectType,
        fieldName,
    } as GraphQLResolveInfo;
}

describe('IdArgumentDecoder', () => {
    describe('decode()', () => {
        it('decodes the ID operators of a filter', () => {
            const createdAt = new Date('2026-01-01');
            const args = {
                options: {
                    take: 5,
                    filter: { id: { eq: 'a', in: ['b', 'c'], isNull: false }, name: 'x', createdAt },
                },
            };

            const result = createDecoder().decode(infoFor('Item', 'children'), args);

            expect(result).toEqual({
                options: {
                    take: 5,
                    filter: {
                        id: { eq: 'decoded:a', in: ['decoded:b', 'decoded:c'], isNull: false },
                        name: 'x',
                        createdAt,
                    },
                },
            });
            expect(result.options.filter.createdAt).toBe(createdAt);
        });

        it('does not change the given args', () => {
            const decoder = createDecoder();
            const filter = { id: { eq: 'a' } };

            const first = decoder.decode(infoFor('Item', 'children'), { options: { filter } });
            const second = decoder.decode(infoFor('Item', 'children'), { options: { filter } });

            expect(filter).toEqual({ id: { eq: 'a' } });
            expect(first.options.filter.id.eq).toBe('decoded:a');
            expect(second.options.filter.id.eq).toBe('decoded:a');
        });

        it('copies args that have no prototype', () => {
            const args = Object.assign(Object.create(null), { id: 'a' });

            const result = createDecoder().decode(infoFor('Query', 'item'), args);

            expect(result).toEqual({ id: 'decoded:a' });
            expect(args.id).toBe('a');
        });
    });

    describe('decodeInPlace()', () => {
        it('decodes ID arguments in place', () => {
            const args = { id: 'a' };

            createDecoder().decodeInPlace(infoFor('Query', 'item'), args);

            expect(args).toEqual({ id: 'decoded:a' });
        });

        it('does not decode job ids when transformJobIds is false', () => {
            const args = { jobId: 'a' };

            createDecoder(false).decodeInPlace(infoFor('Query', 'job'), args);

            expect(args).toEqual({ jobId: 'a' });
        });

        it('decodes job ids when transformJobIds is true', () => {
            const args = { jobId: 'a' };

            createDecoder(true).decodeInPlace(infoFor('Query', 'job'), args);

            expect(args).toEqual({ jobId: 'decoded:a' });
        });
    });
});
