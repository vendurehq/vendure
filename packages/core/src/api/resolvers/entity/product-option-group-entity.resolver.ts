import { Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { Permission } from '@vendure/common/lib/generated-types';
import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';

import { Translated } from '../../../common/types/locale-types';
import { idsAreEqual } from '../../../common/utils';
import { Channel } from '../../../entity/channel/channel.entity';
import { ProductOptionGroup } from '../../../entity/product-option-group/product-option-group.entity';
import { ProductOption } from '../../../entity/product-option/product-option.entity';
import { LocaleStringHydrator } from '../../../service/helpers/locale-string-hydrator/locale-string-hydrator';
import { ProductOptionGroupService } from '../../../service/services/product-option-group.service';
import { RequestContext } from '../../common/request-context';
import { Allow } from '../../decorators/allow.decorator';
import { Ctx } from '../../decorators/request-context.decorator';

@Resolver('ProductOptionGroup')
export class ProductOptionGroupEntityResolver {
    constructor(
        private productOptionGroupService: ProductOptionGroupService,
        private localeStringHydrator: LocaleStringHydrator,
    ) {}

    @ResolveField()
    name(@Ctx() ctx: RequestContext, @Parent() optionGroup: ProductOptionGroup): Promise<string> {
        return this.localeStringHydrator.hydrateLocaleStringField(ctx, optionGroup, 'name');
    }

    @ResolveField()
    languageCode(@Ctx() ctx: RequestContext, @Parent() optionGroup: ProductOptionGroup): Promise<string> {
        return this.localeStringHydrator.hydrateLocaleStringField(ctx, optionGroup, 'languageCode');
    }

    @ResolveField()
    @Allow(Permission.ReadCatalog, Permission.Public, Permission.ReadProduct)
    productCount(@Ctx() ctx: RequestContext, @Parent() optionGroup: ProductOptionGroup): Promise<number> {
        return this.productOptionGroupService.getProductCount(ctx, optionGroup.id);
    }

    @ResolveField()
    @Allow(Permission.ReadCatalog, Permission.Public, Permission.ReadProduct)
    async options(
        @Ctx() ctx: RequestContext,
        @Parent() optionGroup: Translated<ProductOptionGroup>,
    ): Promise<Array<Translated<ProductOption>>> {
        let options: Array<Translated<ProductOption>>;
        if (optionGroup.options) {
            options = optionGroup.options;
        } else {
            const group = await this.productOptionGroupService.findOne(ctx, optionGroup.id, undefined, {
                includeSoftDeleted: true,
            });
            options = group?.options ?? [];
        }
        return options.filter(o => !o.deletedAt);
    }
}

@Resolver('ProductOptionGroup')
export class ProductOptionGroupAdminEntityResolver {
    constructor(private productOptionGroupService: ProductOptionGroupService) {}

    @ResolveField()
    async channels(
        @Ctx() ctx: RequestContext,
        @Parent() optionGroup: ProductOptionGroup,
    ): Promise<Channel[]> {
        const isDefaultChannel = ctx.channel.code === DEFAULT_CHANNEL_CODE;
        const channels =
            optionGroup.channels ||
            (await this.productOptionGroupService.getOptionGroupChannels(ctx, optionGroup.id));
        return channels.filter(channel => (isDefaultChannel ? true : idsAreEqual(channel.id, ctx.channelId)));
    }
}
