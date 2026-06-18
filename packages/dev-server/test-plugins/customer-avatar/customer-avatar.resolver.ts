import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { Asset } from '@vendure/common/lib/generated-types';
import {
    Allow,
    AssetService,
    Ctx,
    CustomerService,
    isGraphQlErrorResult,
    Permission,
    RequestContext,
    Transaction,
} from '@vendure/core';

@Resolver()
export class CustomerAvatarResolver {
    constructor(private assetService: AssetService, private customerService: CustomerService) {}

    @Transaction()
    @Mutation()
    @Allow(Permission.Authenticated)
    async setCustomerAvatar(
        @Ctx() ctx: RequestContext,
        @Args() args: { file: any },
    ): Promise<Asset | undefined> {
        const userId = ctx.activeUserId;
        if (!userId) {
            return;
        }
        const customer = await this.customerService.findOneByUserId(ctx, userId);
        if (!customer) {
            return;
        }
        // Create an Asset from the uploaded file
        const asset = await this.assetService.create(ctx, {
            file: args.file,
            tags: ['avatar'],
        });
        // Check to make sure there was no error when
        // creating the Asset
        if (isGraphQlErrorResult(asset)) {
            // MimeTypeError
            throw asset;
        }
        // Asset created correctly, so assign it as the
        // avatar of the current Customer
        await this.customerService.update(ctx, {
            id: customer.id,
            customFields: {
                avatarId: asset.id,
            },
        });

        return asset;
    }
}
