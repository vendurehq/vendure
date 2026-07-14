import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
    CreateApiKeyResult,
    DeletionResponse,
    MutationCreateApiKeyArgs,
    MutationDeleteApiKeysArgs,
    MutationRotateApiKeyArgs,
    MutationUpdateApiKeyArgs,
    Permission,
    QueryApiKeyArgs,
    QueryApiKeysArgs,
    RotateApiKeyResult,
} from '@vendure/common/lib/generated-types';
import { PaginatedList } from '@vendure/common/lib/shared-types';

import { Ctx, RelationPaths, Relations, RequestContext } from '../..';
import { InternalServerError, Translated } from '../../../common';
import { ApiKey } from '../../../entity/api-key/api-key.entity';
import { ApiKeyService } from '../../../service/services/api-key.service';
import { Allow } from '../../decorators/allow.decorator';
import { Transaction } from '../../decorators/transaction.decorator';

@Resolver('ApiKey')
export class ApiKeyResolver {
    constructor(private apiKeyService: ApiKeyService) {}

    @Query()
    @Allow(Permission.ReadApiKey)
    async apiKey(
        @Ctx() ctx: RequestContext,
        @Args() { id }: QueryApiKeyArgs,
        @Relations(ApiKey) relations: RelationPaths<ApiKey>,
    ): Promise<Translated<ApiKey> | null> {
        return this.apiKeyService.findOne(ctx, id, relations);
    }

    @Query()
    @Allow(Permission.ReadApiKey)
    async apiKeys(
        @Ctx() ctx: RequestContext,
        @Args() { options }: QueryApiKeysArgs,
        @Relations(ApiKey) relations: RelationPaths<ApiKey>,
    ): Promise<PaginatedList<Translated<ApiKey>>> {
        return this.apiKeyService.findAll(ctx, options, relations);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.CreateApiKey)
    async createApiKey(
        @Ctx() ctx: RequestContext,
        @Args() { input }: MutationCreateApiKeyArgs,
    ): Promise<CreateApiKeyResult> {
        if (!ctx.activeUserId)
            throw new InternalServerError('error.active-user-does-not-have-sufficient-permissions');

        return this.apiKeyService.create(ctx, input, ctx.activeUserId);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateApiKey)
    async updateApiKey(
        @Ctx() ctx: RequestContext,
        @Args() { input }: MutationUpdateApiKeyArgs,
        @Relations(ApiKey) relations: RelationPaths<ApiKey>,
    ): Promise<Translated<ApiKey>> {
        return this.apiKeyService.update(ctx, input, relations);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.DeleteApiKey)
    async deleteApiKeys(
        @Ctx() ctx: RequestContext,
        @Args() { ids }: MutationDeleteApiKeysArgs,
    ): Promise<DeletionResponse[]> {
        return Promise.all(ids.map(id => this.apiKeyService.softDelete(ctx, id)));
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateApiKey)
    async rotateApiKey(
        @Ctx() ctx: RequestContext,
        @Args() { id }: MutationRotateApiKeyArgs,
    ): Promise<RotateApiKeyResult> {
        return this.apiKeyService.rotate(ctx, id);
    }
}
