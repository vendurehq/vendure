import { Parent, ResolveField, Resolver } from '@nestjs/graphql';

import { Asset } from '../../../entity/asset/asset.entity';
import { Tag } from '../../../entity/tag/tag.entity';
import { LocaleStringHydrator } from '../../../service/helpers/locale-string-hydrator/locale-string-hydrator';
import { TagService } from '../../../service/services/tag.service';
import { RequestContext } from '../../common/request-context';
import { Ctx } from '../../decorators/request-context.decorator';

@Resolver('Asset')
export class AssetEntityResolver {
    constructor(
        private readonly tagService: TagService,
        private readonly localeStringHydrator: LocaleStringHydrator,
    ) {}

    @ResolveField()
    async name(@Ctx() ctx: RequestContext, @Parent() asset: Asset): Promise<string> {
        // Handle assets without translations (legacy data)
        if (!asset.translations || asset.translations.length === 0) {
            return (asset as any).name ?? '';
        }
        return this.localeStringHydrator.hydrateLocaleStringField(ctx, asset, 'name');
    }

    @ResolveField()
    async languageCode(@Ctx() ctx: RequestContext, @Parent() asset: Asset): Promise<string> {
        // Handle assets without translations (legacy data)
        if (!asset.translations || asset.translations.length === 0) {
            return ctx.languageCode;
        }
        return this.localeStringHydrator.hydrateLocaleStringField(ctx, asset, 'languageCode');
    }

    @ResolveField()
    async translations(@Ctx() ctx: RequestContext, @Parent() asset: Asset): Promise<any[]> {
        // Return empty array for assets without translations (legacy data)
        return asset.translations ?? [];
    }

    @ResolveField()
    async tags(@Ctx() ctx: RequestContext, @Parent() asset: Asset): Promise<Tag[]> {
        if (asset.tags) {
            return asset.tags;
        }
        return this.tagService.getTagsForEntity(ctx, Asset, asset.id);
    }
}
