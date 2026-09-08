import { describe, expect, it } from 'vitest';

import { AuthenticationStrategy } from '../../config/auth/authentication-strategy';

import { generateAuthenticationTypes } from './generate-auth-types';

// Using require right now to force the commonjs version of GraphQL to be used
// when running vitest tests. See https://github.com/vitejs/vite/issues/7879
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { buildSchema, parse, printType } = require('graphql');
/* eslint-disable @typescript-eslint/no-non-null-assertion */

function mockStrategy(name: string, inputSdl: string): AuthenticationStrategy {
    return {
        name,
        defineInputType: () => parse(inputSdl),
        authenticate: () => Promise.resolve(false),
    } as unknown as AuthenticationStrategy;
}

describe('generateAuthenticationTypes()', () => {
    const schema = () =>
        buildSchema(`
            type Query {
                me: String
            }

            type Mutation {
                authenticate(input: AuthenticationInput!): Boolean!
            }

            input AuthenticationInput
        `);

    it('replaces the AuthenticationInput placeholder with a field per strategy', () => {
        const result = generateAuthenticationTypes(schema(), [
            mockStrategy('native', `input NativeAuthInput { username: String! password: String! }`),
            mockStrategy('external', `input ExternalAuthInput { token: String! }`),
        ]);

        expect(printType(result.getType('AuthenticationInput')!)).toBe(
            `input AuthenticationInput {\n  native: NativeAuthInput\n  external: ExternalAuthInput\n}`,
        );
    });

    it('adds the strategy input types to the schema and rewires the mutation arg', () => {
        const result = generateAuthenticationTypes(schema(), [
            mockStrategy('external', `input ExternalAuthInput { token: String! }`),
        ]);

        expect(printType(result.getType('ExternalAuthInput')!)).toBe(
            `input ExternalAuthInput {\n  token: String!\n}`,
        );
        const argType = result.getMutationType()!.getFields().authenticate.args[0].type as any;
        expect(argType.ofType).toBe(result.getType('AuthenticationInput'));
    });

    it('throws if a strategy input type is not an input object type', () => {
        expect(() =>
            generateAuthenticationTypes(schema(), [mockStrategy('bad', `type NotAnInput { foo: String }`)]),
        ).toThrow('does not define a GraphQL Input type');
    });
});
