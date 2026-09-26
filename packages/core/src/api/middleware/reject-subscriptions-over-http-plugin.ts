import { ApolloServerPlugin, GraphQLRequestListener } from '@apollo/server';
import { ApolloServerErrorCode } from '@apollo/server/errors';
import { GraphQLError } from 'graphql';

/**
 * This plugin rejects subscriptions sent over HTTP. Apollo Server would execute them like queries,
 * calling the `resolve` function of their field without the guards, which only apply to its
 * `subscribe` function.
 */
export class RejectSubscriptionsOverHttpPlugin implements ApolloServerPlugin {
    async requestDidStart(): Promise<GraphQLRequestListener<any>> {
        return {
            didResolveOperation: async ({ operation }) => {
                if (operation?.operation === 'subscription') {
                    throw new GraphQLError('Subscriptions are only supported over WebSocket', {
                        extensions: { code: ApolloServerErrorCode.BAD_REQUEST, http: { status: 400 } },
                    });
                }
            },
        };
    }
}
