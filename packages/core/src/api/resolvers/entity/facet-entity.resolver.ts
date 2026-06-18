import { Args, Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { FacetValueListOptions } from '@vendure/common/lib/generated-types';
import { PaginatedList } from '@vendure/common/lib/shared-types';

import { RequestContextCacheService } from '../../../cache/request-context-cache.service';
import { Facet } from '../../../entity/facet/facet.entity';
import { FacetValue } from '../../../entity/facet-value/facet-value.entity';
import { LocaleStringHydrator } from '../../../service/helpers/locale-string-hydrator/locale-string-hydrator';
import { FacetValueService } from '../../../service/services/facet-value.service';
import { RequestContext } from '../../common/request-context';
import { RelationPaths, Relations } from '../../decorators/relations.decorator';
import { Ctx } from '../../decorators/request-context.decorator';

@Resolver('Facet')
export class FacetEntityResolver {
    constructor(
        private facetValueService: FacetValueService,
        private localeStringHydrator: LocaleStringHydrator,
        private requestContextCache: RequestContextCacheService,
    ) {}

    @ResolveField()
    name(@Ctx() ctx: RequestContext, @Parent() facetValue: FacetValue): Promise<string> {
        return this.localeStringHydrator.hydrateLocaleStringField(ctx, facetValue, 'name');
    }

    @ResolveField()
    languageCode(@Ctx() ctx: RequestContext, @Parent() facetValue: FacetValue): Promise<string> {
        return this.localeStringHydrator.hydrateLocaleStringField(ctx, facetValue, 'languageCode');
    }

    @ResolveField()
    async values(@Ctx() ctx: RequestContext, @Parent() facet: Facet): Promise<FacetValue[]> {
        if (facet.values) {
            return facet.values;
        }
        return this.requestContextCache.get(ctx, `FacetEntityResolver.values(${facet.id})`, () =>
            this.facetValueService.findByFacetId(ctx, facet.id),
        );
    }

    @ResolveField()
    async valueList(
        @Ctx() ctx: RequestContext,
        @Parent() facet: Facet,
        @Args() args: { options: FacetValueListOptions },
        @Relations({ entity: FacetValue }) relations: RelationPaths<FacetValue>,
    ): Promise<PaginatedList<FacetValue>> {
        return this.facetValueService.findByFacetIdList(ctx, facet.id, args.options, relations);
    }
}
