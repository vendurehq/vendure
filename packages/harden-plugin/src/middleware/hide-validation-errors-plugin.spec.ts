import { ApolloServer, ApolloServerPlugin, GraphQLResponse } from '@apollo/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { HideValidationErrorsPlugin } from './hide-validation-errors-plugin';

describe('HideValidationErrorsPlugin', () => {
    let server: ApolloServer;

    beforeAll(async () => {
        server = new ApolloServer({
            typeDefs: 'type Query { activeChannel: String }',
            resolvers: { Query: { activeChannel: () => 'default-channel' } },
            plugins: [new HideValidationErrorsPlugin()],
        });
        await server.start();
    });

    afterAll(async () => {
        await server.stop();
    });

    function getSingleResult(body: GraphQLResponse['body']) {
        if (body.kind !== 'single') {
            throw new Error(`Expected a single result, got ${body.kind}`);
        }
        return body.singleResult;
    }

    it('replaces errors containing field suggestions', async () => {
        const { body } = await server.executeOperation({ query: '{ activeChanel }' });
        const { errors } = getSingleResult(body);

        expect(errors).toHaveLength(1);
        expect(errors?.[0].message).toBe('Invalid request');
        expect(JSON.stringify(errors)).not.toContain('Did you mean');
        expect(JSON.stringify(errors)).not.toContain('activeChannel');
    });

    it('keeps the error code and drops locations from replaced errors', async () => {
        const { body } = await server.executeOperation({ query: '{ activeChanel }' });
        const { errors } = getSingleResult(body);

        expect(errors?.[0].extensions?.code).toBe('GRAPHQL_VALIDATION_FAILED');
        expect(errors?.[0].locations).toBeUndefined();
    });

    it('omits extensions when the original error has no code', async () => {
        const stripExtensionsPlugin: ApolloServerPlugin = {
            requestDidStart: () =>
                Promise.resolve({
                    willSendResponse: ({ response }) => {
                        if (response.body.kind === 'single' && response.body.singleResult.errors) {
                            response.body.singleResult.errors = response.body.singleResult.errors.map(
                                ({ message }) => ({ message }),
                            );
                        }
                        return Promise.resolve();
                    },
                }),
        };
        const plainServer = new ApolloServer({
            typeDefs: 'type Query { activeChannel: String }',
            plugins: [stripExtensionsPlugin, new HideValidationErrorsPlugin()],
        });
        await plainServer.start();
        try {
            const { body } = await plainServer.executeOperation({ query: '{ activeChanel }' });
            const { errors } = getSingleResult(body);

            expect(errors).toEqual([{ message: 'Invalid request' }]);
        } finally {
            await plainServer.stop();
        }
    });

    it('only replaces the errors containing suggestions', async () => {
        const { body } = await server.executeOperation({ query: '{ activeChanel nope }' });
        const { errors } = getSingleResult(body);

        expect(errors?.map(e => e.message)).toEqual([
            'Invalid request',
            'Cannot query field "nope" on type "Query".',
        ]);
    });

    it('passes through validation errors without suggestions', async () => {
        const { body } = await server.executeOperation({ query: '{ nope }' });
        const { errors } = getSingleResult(body);

        expect(errors).toHaveLength(1);
        expect(errors?.[0].message).toBe('Cannot query field "nope" on type "Query".');
    });

    it('does not affect valid queries', async () => {
        const { body } = await server.executeOperation({ query: '{ activeChannel }' });
        const result = getSingleResult(body);

        expect(result.errors).toBeUndefined();
        expect(result.data).toEqual({ activeChannel: 'default-channel' });
    });
});
