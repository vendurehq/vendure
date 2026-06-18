// Using require right now to force the commonjs version of GraphQL to be used
// when running vitest tests. See https://github.com/vitejs/vite/issues/7879
// eslint-disable-next-line @typescript-eslint/no-var-requires
import { describe, expect, it } from 'vitest';

import { generateListOptions } from './generate-list-options';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { buildSchema, printType } = require('graphql');
/* eslint-disable @typescript-eslint/no-non-null-assertion */

describe('generateListOptions()', () => {
    const COMMON_TYPES = `
    scalar JSON
    scalar DateTime

    interface PaginatedList {
        items: [Node!]!
        totalItems: Int!
    }

    interface Node {
        id: ID!
    }

    enum SortOrder {
        ASC
        DESC
    }

    input IDOperators { dummy: String }

    input StringOperators { dummy: String }

    input BooleanOperators { dummy: String }

    input NumberRange { dummy: String }

    input NumberOperators { dummy: String }

    input DateRange { dummy: String }

    input DateOperators { dummy: String }

    type PersonList implements PaginatedList {
        items: [Person!]!
        totalItems: Int!
    }
    `;

    const removeLeadingWhitespace = (s: string) => {
        const indent = s.match(/^\s+/m)![0].replace(/\n/, '');
        return s.replace(new RegExp(`^${indent}`, 'gm'), '').trim();
    };

    it('creates the required input types', () => {
        const input = `
                ${COMMON_TYPES}
               type Query {
                   people(options: PersonListOptions): PersonList
               }

               type Person {
                   name: String!
                   age: Int!
               }

               # Generated at runtime
               input PersonListOptions
           `;

        const result = generateListOptions(input);

        expect(printType(result.getType('PersonListOptions')!)).toBe(
            removeLeadingWhitespace(`
                   input PersonListOptions {
                     """Skips the first n results, for use in pagination"""
                     skip: Int

                     """Takes n results, for use in pagination"""
                     take: Int

                     """Specifies which properties to sort the results by"""
                     sort: PersonSortParameter

                     """Allows the results to be filtered"""
                     filter: PersonFilterParameter
                   }`),
        );

        expect(printType(result.getType('PersonSortParameter')!)).toBe(
            removeLeadingWhitespace(`
                   input PersonSortParameter {
                     name: SortOrder
                     age: SortOrder
                   }`),
        );

        expect(printType(result.getType('PersonFilterParameter')!)).toBe(
            removeLeadingWhitespace(`
                   input PersonFilterParameter {
                     name: StringOperators
                     age: NumberOperators
                     _and: [PersonFilterParameter!]
                     _or: [PersonFilterParameter!]
                   }`),
        );
    });

    it('works with a non-nullabel list type', () => {
        const input = `
                ${COMMON_TYPES}
               type Query {
                   people: PersonList!
               }

               type Person {
                   name: String!
                   age: Int!
               }
           `;

        const result = generateListOptions(buildSchema(input));

        expect(result.getType('PersonListOptions')).toBeTruthy();
    });

    it('uses the correct filter operators', () => {
        const input = `
                ${COMMON_TYPES}
               type Query {
                   people(options: PersonListOptions): PersonList
               }

               type Person {
                   name: String!
                   age: Int!
                   updatedAt: DateTime!
                   admin: Boolean!
                   score: Float
                   personType: PersonType!
               }

               enum PersonType {
                   TABS
                   SPACES
               }

               # Generated at runtime
               input PersonListOptions
           `;

        const result = generateListOptions(buildSchema(input));

        expect(printType(result.getType('PersonFilterParameter')!)).toBe(
            removeLeadingWhitespace(`
                   input PersonFilterParameter {
                     name: StringOperators
                     age: NumberOperators
                     updatedAt: DateOperators
                     admin: BooleanOperators
                     score: NumberOperators
                     personType: StringOperators
                     _and: [PersonFilterParameter!]
                     _or: [PersonFilterParameter!]
                   }`),
        );
    });

    it('creates the ListOptions interface and argument if not defined', () => {
        const input = `
               ${COMMON_TYPES}
               type Query {
                   people: PersonList
               }

               type Person {
                   name: String!
               }
           `;

        const result = generateListOptions(buildSchema(input));

        expect(printType(result.getType('PersonListOptions')!)).toBe(
            removeLeadingWhitespace(`
                    input PersonListOptions {
                      """Skips the first n results, for use in pagination"""
                      skip: Int

                      """Takes n results, for use in pagination"""
                      take: Int

                      """Specifies which properties to sort the results by"""
                      sort: PersonSortParameter

                      """Allows the results to be filtered"""
                      filter: PersonFilterParameter
                    }`),
        );

        const args = result.getQueryType()!.getFields().people.args;
        expect(args.length).toBe(1);
        expect(args[0].name).toBe('options');
        expect(args[0].type.toString()).toBe('PersonListOptions');
    });

    it('extends the ListOptions interface if already defined', () => {
        const input = `
               ${COMMON_TYPES}
               type Query {
                   people(options: PersonListOptions): PersonList
               }

               type Person {
                   name: String!
               }

               input PersonListOptions {
                   categoryId: ID
               }
           `;

        const result = generateListOptions(buildSchema(input));

        expect(printType(result.getType('PersonListOptions')!)).toBe(
            removeLeadingWhitespace(`
                    input PersonListOptions {
                      categoryId: ID

                      """Skips the first n results, for use in pagination"""
                      skip: Int

                      """Takes n results, for use in pagination"""
                      take: Int

                      """Specifies which properties to sort the results by"""
                      sort: PersonSortParameter

                      """Allows the results to be filtered"""
                      filter: PersonFilterParameter
                    }`),
        );

        const args = result.getQueryType()!.getFields().people.args;
        expect(args.length).toBe(1);
        expect(args[0].name).toBe('options');
        expect(args[0].type.toString()).toBe('PersonListOptions');
    });

    it('ignores properties with types which cannot be sorted or filtered', () => {
        const input = `
               ${COMMON_TYPES}
               type Query {
                   people: PersonList
               }

               type Person {
                   id: ID!
                   name: String!
                   vitals: [Int]
                   meta: JSON
                   user: User!
               }

               type User {
                   identifier: String!
               }
           `;

        const result = generateListOptions(buildSchema(input));

        expect(printType(result.getType('PersonSortParameter')!)).toBe(
            removeLeadingWhitespace(`
                   input PersonSortParameter {
                     id: SortOrder
                     name: SortOrder
                   }`),
        );

        expect(printType(result.getType('PersonFilterParameter')!)).toBe(
            removeLeadingWhitespace(`
                   input PersonFilterParameter {
                     id: IDOperators
                     name: StringOperators
                     _and: [PersonFilterParameter!]
                     _or: [PersonFilterParameter!]
                   }`),
        );
    });

    it('generates ListOptions for nested list queries', () => {
        const input = `
               ${COMMON_TYPES}
               type Query {
                   people: PersonList
               }

               type Person {
                   id: ID!
                   orders(options: OrderListOptions): OrderList
               }

               type OrderList implements PaginatedList {
                   items: [Order!]!
                   totalItems: Int!
               }

               type Order {
                   id: ID!
                   code: String!
               }

               # Generated at runtime
               input OrderListOptions
           `;

        const result = generateListOptions(buildSchema(input));

        expect(printType(result.getType('OrderListOptions')!)).toBe(
            removeLeadingWhitespace(`
                   input OrderListOptions {
                     """Skips the first n results, for use in pagination"""
                     skip: Int

                     """Takes n results, for use in pagination"""
                     take: Int

                     """Specifies which properties to sort the results by"""
                     sort: OrderSortParameter

                     """Allows the results to be filtered"""
                     filter: OrderFilterParameter
                   }`),
        );
        expect(printType(result.getType('OrderSortParameter')!)).toBe(
            removeLeadingWhitespace(`
                   input OrderSortParameter {
                     id: SortOrder
                     code: SortOrder
                   }`),
        );

        expect(printType(result.getType('OrderFilterParameter')!)).toBe(
            removeLeadingWhitespace(`
                   input OrderFilterParameter {
                     id: IDOperators
                     code: StringOperators
                     _and: [OrderFilterParameter!]
                     _or: [OrderFilterParameter!]
                   }`),
        );
    });
});
