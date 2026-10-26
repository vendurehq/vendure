import { ApolloServerPlugin, GraphQLRequestListener, GraphQLServerContext } from '@apollo/server';
import { isObject } from '@vendure/common/lib/shared-utils';
import { DocumentNode } from 'graphql';

import { ApiType } from '../common/get-api-type';
import { GraphqlValueTransformer } from '../common/graphql-value-transformer';
import { IdCodecService } from '../common/id-codec.service';

/**
 * Encodes the ids of outgoing responses according to the configured EntityIdStrategy.
 *
 * This is done here and not via a Nest Interceptor because it's not possible
 * according to https://github.com/nestjs/graphql/issues/320
 */
export class IdCodecPlugin implements ApolloServerPlugin {
    private graphqlValueTransformer: GraphqlValueTransformer;
    // Job ids only exist in the Admin API. A plugin could define its own `Job` type in the Shop API.
    private readonly transformJobIds: boolean;
    constructor(
        private idCodecService: IdCodecService,
        apiType: ApiType,
    ) {
        this.transformJobIds = apiType !== 'admin' || idCodecService.transformJobIds;
    }

    async serverWillStart(service: GraphQLServerContext): Promise<void> {
        this.graphqlValueTransformer = new GraphqlValueTransformer(service.schema);
    }

    async requestDidStart(): Promise<GraphQLRequestListener<any>> {
        return {
            willSendResponse: async requestContext => {
                const { document } = requestContext;
                if (document) {
                    const { body } = requestContext.response;
                    if (body.kind === 'single') {
                        this.encodeIdFields(document, body.singleResult.data);
                    }
                }
            },
        };
    }

    private encodeIdFields(document: DocumentNode, data?: Record<string, unknown> | null) {
        if (!data) {
            return;
        }
        const typeTree = this.graphqlValueTransformer.getOutputTypeTree(document);
        this.graphqlValueTransformer.transformValues(typeTree, data, (value, type, parentType) => {
            const isIdType = type && type.name === 'ID';
            if (isIdType && parentType?.name === 'Job' && !this.transformJobIds) {
                return value;
            }
            if (type && type.name === 'JSON' && isObject(value)) {
                return this.idCodecService.encode(value, [
                    'paymentId',
                    'fulfillmentId',
                    'orderItemIds',
                    'orderLineId',
                    'promotionId',
                    'refundId',
                    'groupId',
                    'modificationId',
                    'previousCustomerId',
                    'newCustomerId',
                ]);
            }
            return isIdType ? this.idCodecService.encode(value) : value;
        });
    }
}
