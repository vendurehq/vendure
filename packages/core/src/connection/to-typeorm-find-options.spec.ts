import { describe, expect, it } from 'vitest';

import { toTypeOrmFindOptions } from './to-typeorm-find-options';
import { VendureFindManyOptions } from './types';

interface TestProductVariant {
    id: string;
    sku: string;
    product: { id: string; name: string };
}

interface TestOrder {
    id: string;
    code: string;
    customer: { id: string };
    lines: Array<{ id: string; productVariant: TestProductVariant }>;
}

describe('toTypeOrmFindOptions()', () => {
    it('returns an empty object for empty options', () => {
        expect(toTypeOrmFindOptions<TestOrder, VendureFindManyOptions<TestOrder>>({})).toEqual({});
    });

    describe('relations', () => {
        it('converts an array to the object form', () => {
            const result = toTypeOrmFindOptions<TestOrder, VendureFindManyOptions<TestOrder>>({
                relations: ['customer', 'lines.productVariant'],
            });

            expect(result.relations).toEqual({
                customer: true,
                lines: { productVariant: true },
            });
        });

        it('converts an empty array to an empty object', () => {
            const result = toTypeOrmFindOptions<TestOrder, VendureFindManyOptions<TestOrder>>({
                relations: [],
            });

            expect(result.relations).toEqual({});
        });

        it('passes the object form through unchanged', () => {
            const relations = { customer: true, lines: { productVariant: true } };
            const result = toTypeOrmFindOptions<TestOrder, VendureFindManyOptions<TestOrder>>({
                relations,
            });

            expect(result.relations).toBe(relations);
        });

        it('omits the property when no relations are given', () => {
            const result = toTypeOrmFindOptions<TestOrder, VendureFindManyOptions<TestOrder>>({
                where: { id: '1' },
            });

            expect('relations' in result).toBe(false);
        });
    });

    describe('select', () => {
        it('converts an array to the object form', () => {
            const result = toTypeOrmFindOptions<TestOrder, VendureFindManyOptions<TestOrder>>({
                select: ['id', 'code'],
            });

            expect(result.select).toEqual({ id: true, code: true });
        });

        it('expands dotted paths into nested objects', () => {
            const result = toTypeOrmFindOptions<TestOrder, VendureFindManyOptions<TestOrder>>({
                select: ['id', 'lines.productVariant.sku'],
            });

            expect(result.select).toEqual({
                id: true,
                lines: { productVariant: { sku: true } },
            });
        });

        it('converts an empty array to an empty object', () => {
            const result = toTypeOrmFindOptions<TestOrder, VendureFindManyOptions<TestOrder>>({
                select: [],
            });

            expect(result.select).toEqual({});
        });

        it('passes the object form through unchanged', () => {
            const select = { id: true as const, lines: { id: true as const } };
            const result = toTypeOrmFindOptions<TestOrder, VendureFindManyOptions<TestOrder>>({
                select,
            });

            expect(result.select).toBe(select);
        });

        it('omits the property when no select is given', () => {
            const result = toTypeOrmFindOptions<TestOrder, VendureFindManyOptions<TestOrder>>({
                where: { id: '1' },
            });

            expect('select' in result).toBe(false);
        });
    });

    it('converts relations and select in the same call', () => {
        const result = toTypeOrmFindOptions<TestOrder, VendureFindManyOptions<TestOrder>>({
            relations: ['customer'],
            select: ['id'],
        });

        expect(result).toEqual({
            relations: { customer: true },
            select: { id: true },
        });
    });

    it('carries the remaining find options through untouched', () => {
        const where = { code: 'ABC' };
        const order = { code: 'ASC' as const };
        const result = toTypeOrmFindOptions<TestOrder, VendureFindManyOptions<TestOrder>>({
            where,
            order,
            take: 10,
            skip: 20,
            relations: ['customer'],
        });

        expect(result.where).toBe(where);
        expect(result.order).toBe(order);
        expect(result.take).toBe(10);
        expect(result.skip).toBe(20);
    });

    it('does not mutate the options it is given', () => {
        const options: VendureFindManyOptions<TestOrder> = {
            relations: ['customer'],
            select: ['id'],
        };

        toTypeOrmFindOptions<TestOrder, VendureFindManyOptions<TestOrder>>(options);

        expect(options.relations).toEqual(['customer']);
        expect(options.select).toEqual(['id']);
    });
});
