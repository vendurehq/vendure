import { Parent, ResolveField, Resolver } from '@nestjs/graphql';

import { ShippingMethod } from '../../../entity/shipping-method/shipping-method.entity';
import { LocaleStringHydrator } from '../../../service/helpers/locale-string-hydrator/locale-string-hydrator';
import { RequestContext } from '../../common/request-context';
import { Ctx } from '../../decorators/request-context.decorator';

@Resolver('ShippingMethod')
export class ShippingMethodEntityResolver {
    constructor(private localeStringHydrator: LocaleStringHydrator) {}

    @ResolveField()
    name(@Ctx() ctx: RequestContext, @Parent() shippingMethod: ShippingMethod): Promise<string> {
        return this.localeStringHydrator.hydrateLocaleStringField(ctx, shippingMethod, 'name');
    }

    @ResolveField()
    description(@Ctx() ctx: RequestContext, @Parent() shippingMethod: ShippingMethod): Promise<string> {
        return this.localeStringHydrator.hydrateLocaleStringField(ctx, shippingMethod, 'description');
    }

    @ResolveField()
    languageCode(@Ctx() ctx: RequestContext, @Parent() shippingMethod: ShippingMethod): Promise<string> {
        return this.localeStringHydrator.hydrateLocaleStringField(ctx, shippingMethod, 'languageCode');
    }
}
