import { ApolloServerPlugin, GraphQLRequestListener } from '@apollo/server';
import { GraphQLFormattedError } from 'graphql';

/**
 * @description
 * Hides graphql-js suggestions when invalid field names are given.
 * Based on ideas discussed in https://github.com/apollographql/apollo-server/issues/3919
 *
 * The suggestion is replaced with a bare "Invalid request" error rather than just having its
 * message rewritten, because the whole error is a disclosure risk: `extensions` carries a
 * stack trace whenever the server is not running with `NODE_ENV=production`.
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
