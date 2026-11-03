import { ApolloServerPlugin, GraphQLRequestListener } from '@apollo/server';
/**
 * @description
 * Hides graphql-js suggestions when invalid field names are given.
 * Based on ideas discussed in https://github.com/apollographql/apollo-server/issues/3919
 */
export declare class HideValidationErrorsPlugin implements ApolloServerPlugin {
    requestDidStart(): Promise<GraphQLRequestListener<any>>;
}
