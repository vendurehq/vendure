import { ApolloServerPlugin, GraphQLRequestListener } from '@apollo/server';
import { GraphQLError } from 'graphql/error/index';

/**
 * @description
 * Hides graphql-js suggestions when invalid field names are given.
 * Based on ideas discussed in https://github.com/apollographql/apollo-server/issues/3919
 */
export class HideValidationErrorsPlugin implements ApolloServerPlugin {
    async requestDidStart(): Promise<GraphQLRequestListener<any>> {
        return {
            willSendResponse: async requestContext => {
                const { errors } = requestContext;
                if (errors) {
                    (requestContext.response as any).errors = errors.map(err => {
                        if (err.message.includes('Did you mean')) {
                            return new GraphQLError('Invalid request');
                        } else {
                            return err;
                        }
                    });
                }
            },
        };
    }
}
