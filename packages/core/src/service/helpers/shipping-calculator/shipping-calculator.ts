import { Injectable } from '@nestjs/common';
import { ID } from '@vendure/common/lib/shared-types';
import { notNullOrUndefined } from '@vendure/common/lib/shared-utils';

import { RequestContext } from '../../../api/common/request-context';
import { ShippingCalculationResult } from '../../../config/shipping-method/shipping-calculator';
import { Order } from '../../../entity/order/order.entity';
import { ShippingMethod } from '../../../entity/shipping-method/shipping-method.entity';
import { ShippingMethodService } from '../../services/shipping-method.service';

type EligibleShippingMethod = {
    method: ShippingMethod;
    result: ShippingCalculationResult;
};

@Injectable()
export class ShippingCalculator {
    constructor(private shippingMethodService: ShippingMethodService) {}

    /**
     * Returns an array of each eligible ShippingMethod for the given Order and sorts them by
     * price, with the cheapest first.
     *
     * The `skipIds` argument is used to skip ShippingMethods with those IDs from being checked and calculated.
     */
    async getEligibleShippingMethods(
        ctx: RequestContext,
        order: Order,
        skipIds: ID[] = [],
    ): Promise<EligibleShippingMethod[]> {
        const shippingMethods = (await this.shippingMethodService.getActiveShippingMethods(ctx)).filter(
            method => !skipIds.includes(method.id),
        );

        const checkEligibilityPromises = shippingMethods.map(method =>
            this.checkEligibilityByShippingMethod(ctx, order, method),
        );
        const eligibleMethods = await Promise.all(checkEligibilityPromises);

        return eligibleMethods.filter(notNullOrUndefined).sort((a, b) => a.result.price - b.result.price);
    }

    async getMethodIfEligible(
        ctx: RequestContext,
        order: Order,
        shippingMethodId: ID,
    ): Promise<ShippingMethod | undefined> {
        const method = await this.shippingMethodService.findOne(ctx, shippingMethodId);
        if (method) {
            const eligible = await method.test(ctx, order);
            if (eligible) {
                return method;
            }
        }
    }

    private async checkEligibilityByShippingMethod(
        ctx: RequestContext,
        order: Order,
        method: ShippingMethod,
    ): Promise<EligibleShippingMethod | undefined> {
        const eligible = await method.test(ctx, order);
        if (eligible) {
            const result = await method.apply(ctx, order);
            if (result) {
                return { method, result };
            }
        }
    }
}
