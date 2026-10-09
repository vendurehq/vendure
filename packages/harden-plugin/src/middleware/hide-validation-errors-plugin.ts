import { ApolloServerPlugin, GraphQLRequestListener } from '@apollo/server';
import { GraphQLFormattedError } from 'graphql';

/**
 * @description
 * Hides graphql-js suggestions when invalid field names are given.
 * Based on ideas discussed in https://github.com/apollographql/apollo-server/issues/3919
 */
export class HideValidationErrorsPlugin implements ApolloServerPlugin {
    async requestDidStart(): Promise<GraphQLRequestListener<any>> {
        return {
            willSendResponse: async requestContext => {
                const { body } = requestContext.response;
                if (body.kind === 'single' && body.singleResult.errors) {
                    body.singleResult.errors = body.singleResult.errors.map((err): GraphQLFormattedError => {
                        if (err.message.includes('Did you mean')) {
                            const code = err.extensions?.code;
                            return code
                                ? { message: 'Invalid request', extensions: { code } }
                                : { message: 'Invalid request' };
                        } else {
                            return err;
                        }
                    });
                }
            },
        };
    }
}
