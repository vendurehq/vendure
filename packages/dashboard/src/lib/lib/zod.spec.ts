import { describe, expect, it } from 'vitest';
import { z as z3 } from 'zod/v3';

import { z, zodResolver } from './zod.js';

const resolverOptions = {
    fields: {},
    shouldUseNativeValidation: false,
    criteriaMode: 'firstError' as const,
};

describe('zod re-exports', () => {
    describe('z (schema builder)', () => {
        it('should create and validate a basic object schema', () => {
            const schema = z.object({
                name: z.string().min(1),
                age: z.number(),
                active: z.boolean(),
            });

            expect(() => schema.parse({ name: 'Test', age: 25, active: true })).not.toThrow();
            expect(() => schema.parse({ name: '', age: 25, active: true })).toThrow();
        });

        it('should support optional, nullable, and array modifiers', () => {
            const schema = z.object({
                tags: z.array(z.string()),
                description: z.string().optional(),
                metadata: z.any().nullable(),
            });

            expect(() => schema.parse({ tags: ['a', 'b'], metadata: null })).not.toThrow();
            expect(() => schema.parse({ tags: 'not-array', metadata: null })).toThrow();
        });

        it('should support z.infer for type extraction', () => {
            const schema = z.object({ name: z.string(), count: z.number() });
            type Inferred = z.infer<typeof schema>;

            // Compile-time check — if z.infer is broken this file won't compile.
            // Runtime: verify the parsed output matches the inferred type shape.
            const parsed: Inferred = schema.parse({ name: 'test', count: 42 });
            expect(parsed).toEqual({ name: 'test', count: 42 });
        });
    });

    describe('zodResolver (react-hook-form integration)', () => {
        it('should return a resolver function', () => {
            const schema = z.object({ name: z.string().min(1) });
            const resolver = zodResolver(schema);

            expect(typeof resolver).toBe('function');
        });

        it('should resolve valid data with no errors', async () => {
            const schema = z.object({
                email: z.string().min(1),
                password: z.string().min(8),
            });

            const resolver = zodResolver(schema);
            const result = await resolver(
                { email: 'user@test.com', password: 'securepass' },
                undefined,
                resolverOptions,
            );

            expect(result.errors).toEqual({});
            expect(result.values).toEqual({ email: 'user@test.com', password: 'securepass' });
        });

        it('should resolve invalid data with specific field errors', async () => {
            const schema = z.object({
                email: z.string().min(1),
                password: z.string().min(8),
            });

            const resolver = zodResolver(schema);
            const result = await resolver({ email: '', password: 'short' }, undefined, resolverOptions);

            expect(result.values).toEqual({});
            expect(result.errors.email).toBeDefined();
            expect(result.errors.email?.type).toBe('too_small');
            expect(result.errors.password).toBeDefined();
            expect(result.errors.password?.type).toBe('too_small');
        });

        it('should work with refine for custom validation', async () => {
            const schema = z.object({
                price: z.string().refine(val => !isNaN(Number(val)) && Number(val) >= 0, {
                    message: 'Must be a non-negative number',
                }),
            });

            const resolver = zodResolver(schema);

            const valid = await resolver({ price: '10.50' }, undefined, resolverOptions);
            expect(valid.errors).toEqual({});

            const invalid = await resolver({ price: 'not-a-number' }, undefined, resolverOptions);
            expect(invalid.errors.price?.message).toBe('Must be a non-negative number');
        });
    });

    describe('backward compatibility with direct zod v3 imports', () => {
        // These tests simulate an extension developer who imports zod v3 directly
        // (not from @vendure/dashboard) and passes schemas to the dashboard's zodResolver.
        // This must keep working since existing extensions use this pattern.

        it('should resolve a zod v3 schema with valid data', async () => {
            const schema = z3.object({
                name: z3.string().min(1),
                email: z3.string().min(1),
            });

            const resolver = zodResolver(schema);
            const result = await resolver(
                { name: 'John', email: 'john@example.com' },
                undefined,
                resolverOptions,
            );

            expect(result.errors).toEqual({});
            expect(result.values).toEqual({ name: 'John', email: 'john@example.com' });
        });

        it('should resolve a zod v3 schema with invalid data and return field errors', async () => {
            const schema = z3.object({
                name: z3.string().min(2, { message: 'Name too short' }),
                count: z3.number().min(0),
            });

            const resolver = zodResolver(schema);
            const result = await resolver({ name: 'J', count: -1 }, undefined, resolverOptions);

            expect(result.values).toEqual({});
            expect(result.errors.name?.message).toBe('Name too short');
            expect(result.errors.count?.type).toBe('too_small');
        });

        it('should handle zod v3 schemas with optional, nullable, and default modifiers', async () => {
            const schema = z3.object({
                required: z3.string().min(1),
                optional: z3.string().optional(),
                nullable: z3.string().nullable(),
                withDefault: z3.boolean().default(false),
            });

            const resolver = zodResolver(schema);
            const result = await resolver({ required: 'value', nullable: null }, undefined, resolverOptions);

            expect(result.errors).toEqual({});
            expect(result.values.required).toBe('value');
            expect(result.values.nullable).toBeNull();
            expect(result.values.withDefault).toBe(false);
        });

        it('should handle zod v3 schemas with refine and custom error messages', async () => {
            const schema = z3
                .object({
                    password: z3.string().min(8),
                    confirmPassword: z3.string(),
                })
                .refine(data => data.password === data.confirmPassword, {
                    message: 'Passwords do not match',
                    path: ['confirmPassword'],
                });

            const resolver = zodResolver(schema);
            const result = await resolver(
                { password: 'securepass', confirmPassword: 'different' },
                undefined,
                resolverOptions,
            );

            expect(result.errors.confirmPassword?.message).toBe('Passwords do not match');
        });

        it('should handle zod v3 schemas with nested objects and arrays', async () => {
            const schema = z3.object({
                options: z3.array(
                    z3.object({
                        name: z3.string().min(1),
                        values: z3.array(z3.string().min(1)).min(1),
                    }),
                ),
            });

            const resolver = zodResolver(schema);

            const valid = await resolver(
                { options: [{ name: 'Color', values: ['Red', 'Blue'] }] },
                undefined,
                resolverOptions,
            );
            expect(valid.errors).toEqual({});

            const invalid = await resolver(
                { options: [{ name: '', values: [] }] },
                undefined,
                resolverOptions,
            );
            expect(Object.keys(invalid.errors).some(k => k.includes('options'))).toBe(true);
        });
    });
});
