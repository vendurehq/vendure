import { Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { ConfigurableOperation } from '@vendure/common/lib/generated-types';

import { ShippingCalculator } from '../../../config/shipping-method/shipping-calculator';
import { ShippingEligibilityChecker } from '../../../config/shipping-method/shipping-eligibility-checker';
import { ShippingMethod } from '../../../entity/shipping-method/shipping-method.entity';
import { LocaleStringHydrator } from '../../../service/helpers/locale-string-hydrator/locale-string-hydrator';
import { ConfigurableOperationCodec } from '../../common/configurable-operation-codec';
import { RequestContext } from '../../common/request-context';
import { Ctx } from '../../decorators/request-context.decorator';

@Resolver('ShippingMethod')
export class ShippingMethodEntityResolver {
    constructor(
        private localeStringHydrator: LocaleStringHydrator,
        private configurableOperationCodec: ConfigurableOperationCodec,
    ) {}

    @ResolveField()
    async checker(
        @Ctx() ctx: RequestContext,
        @Parent() shippingMethod: ShippingMethod,
    ): Promise<ConfigurableOperation | null> {
        if (!shippingMethod.checker) {
            return null;
        }
        const [checker] = await this.configurableOperationCodec.redactSecretArgs(
            ctx,
            ShippingEligibilityChecker,
            [shippingMethod.checker],
            shippingMethod,
        );
        return checker;
    }

    @ResolveField()
    async calculator(
        @Ctx() ctx: RequestContext,
        @Parent() shippingMethod: ShippingMethod,
    ): Promise<ConfigurableOperation | null> {
        if (!shippingMethod.calculator) {
            return null;
        }
        const [calculator] = await this.configurableOperationCodec.redactSecretArgs(
            ctx,
            ShippingCalculator,
            [shippingMethod.calculator],
            shippingMethod,
        );
        return calculator;
    }

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
