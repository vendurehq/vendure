/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { OnModuleInit } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';
import {
    Asset,
    AssetEvent,
    AssetService,
    Ctx,
    EventBus,
    ID,
    Logger,
    PluginCommonModule,
    RequestContext,
    Transaction,
    TransactionalConnection,
    VendurePlugin,
} from '@vendure/core';
import gql from 'graphql-tag';

@Resolver()
class TestResolver {
    constructor(private assetService: AssetService) {}

    @Transaction()
    @Mutation()
    async setAssetName(@Ctx() ctx: RequestContext, @Args() args: { id: ID; name: string }) {
        await this.assetService.update(ctx, {
            id: args.id,
            name: args.name,
        });
        await new Promise(resolve => setTimeout(resolve, 500));
        Logger.info('setAssetName returning');
        return true;
    }
}

// A plugin to explore solutions to https://github.com/vendurehq/vendure/issues/1107
@VendurePlugin({
    imports: [PluginCommonModule],
    adminApiExtensions: {
        schema: gql`
            extend type Mutation {
                setAssetName(id: ID!, name: String!): Boolean
            }
        `,
        resolvers: [TestResolver],
    },
})
export class EventBusTransactionsPlugin implements OnModuleInit {
    constructor(
        private eventBus: EventBus,
        private connection: TransactionalConnection,
    ) {}

    onModuleInit(): any {
        this.eventBus.ofType(AssetEvent).subscribe(async event => {
            Logger.info('Event handler started');
            const repository = this.connection.getRepository(event.ctx, Asset);
            await new Promise(resolve => setTimeout(resolve, 1000));
            const asset = await repository.findOne(event.asset.id);
            Logger.info(`The asset name is ${asset?.name as string}`);
            asset!.name = asset!.name + ' modified';
            await repository.save(asset!);
        });
    }
}
