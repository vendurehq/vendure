import { ApolloServerPlugin, GraphQLRequestListener } from '@apollo/server';
import { GraphQLFormattedError } from 'graphql';

/**
 * @description
 * Hides graphql-js suggestions when invalid field names are given.
 * Based on ideas discussed in https://github.com/apollographql/apollo-server/issues/3919
 *
 * The whole error is replaced with a bare "Invalid request" error, so that none of its other
 * fields (`locations`, `extensions`) reach the client either.
 */
export class HideValidationErrorsPlugin implements ApolloServerPlugin {
    async requestDidStart(): Promise<GraphQLRequestListener<any>> {
        return {
            willSendResponse: async requestContext => {
                const { body } = requestContext.response;
                // `@defer`/`@stream` responses deliver errors incrementally. Vendure does not
                // enable them, so only the single-result shape is handled here.
                if (body.kind !== 'single' || !body.singleResult.errors) {
                    return;
                }
                body.singleResult.errors = body.singleResult.errors.map(error =>
                    error.message.includes('Did you mean')
                        ? ({ message: 'Invalid request' } as GraphQLFormattedError)
                        : error,
                );
            },
        };
    }
}
