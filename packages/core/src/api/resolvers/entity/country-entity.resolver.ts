import { Parent, ResolveField, Resolver } from '@nestjs/graphql';

import { Country } from '../../../entity/region/country.entity';
import { LocaleStringHydrator } from '../../../service/helpers/locale-string-hydrator/locale-string-hydrator';
import { RequestContext } from '../../common/request-context';
import { Ctx } from '../../decorators/request-context.decorator';

@Resolver('Country')
export class CountryEntityResolver {
    constructor(private localeStringHydrator: LocaleStringHydrator) {}

    @ResolveField()
    name(@Ctx() ctx: RequestContext, @Parent() country: Country): Promise<string> {
        return this.localeStringHydrator.hydrateLocaleStringField(ctx, country, 'name');
    }

    @ResolveField()
    languageCode(@Ctx() ctx: RequestContext, @Parent() country: Country): Promise<string> {
        return this.localeStringHydrator.hydrateLocaleStringField(ctx, country, 'languageCode');
    }
}
