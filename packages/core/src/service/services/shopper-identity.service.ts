import { Injectable } from '@nestjs/common';
import { ID } from '@vendure/common/lib/shared-types';
import { AsyncLocalStorage } from 'node:async_hooks';

import { RequestContext } from '../../api/common/request-context';
import { RequestContextCacheService } from '../../cache/request-context-cache.service';
import { Customer } from '../../entity/customer/customer.entity';

import { CustomerService } from './customer.service';

type ShopperScope = { customerId: ID | undefined };

/**
 * @description
 * Gives the Customer that a price is for. A {@link ProductVariantShopperPriceStrategy} uses this
 * service to find the shopper.
 *
 * * In the cart, the default {@link OrderItemPriceCalculationStrategy} calls the shopper price strategy
 *   inside `runForCustomer()` with the Customer of the Order. Thus the price is for the Customer of the
 *   Order: in an Admin draft order this is the Customer, not the Administrator, and in a guest Order it
 *   is the guest Customer.
 * * Outside `runForCustomer()`, for example for the Shop API `ProductVariant.shopperPrice` field, the
 *   service gives the Customer of the active User, or `undefined` for a guest session.
 *
 * Both methods cache their result for each request, so a strategy can call them for each OrderLine
 * without a query for each line.
 *
 * A custom {@link OrderItemPriceCalculationStrategy} gets the same scope when it calls
 * `ProductVariantService.calculateShopperPriceForOrder()`.
 *
 * @example
 * ```ts
 * export class CustomerPriceLayer extends StrategyLayer.passThrough<ProductVariantShopperPriceStrategy>() {
 *     static priority = 100;
 *     private shopperIdentityService: ShopperIdentityService;
 *
 *     init(injector: Injector) {
 *         this.shopperIdentityService = injector.get(ShopperIdentityService);
 *     }
 *
 *     async calculateUnitPrice(...args: Parameters<ProductVariantShopperPriceStrategy['calculateUnitPrice']>) {
 *         const [ctx] = args;
 *         const result = await this.inner.calculateUnitPrice(...args);
 *         const customerId = await this.shopperIdentityService.getCustomerId(ctx);
 *         // look up the price for this Customer
 *         return result;
 *     }
 * }
 * ```
 *
 * @docsCategory services
 * @since 4.0.0
 */
@Injectable()
export class ShopperIdentityService {
    private scope = new AsyncLocalStorage<ShopperScope>();

    constructor(
        private requestCache: RequestContextCacheService,
        private customerService: CustomerService,
    ) {}

    /**
     * @description
     * Runs `fn` with the given Customer as the shopper. Inside `fn`, `getCustomerId()` and `getCustomer()`
     * give this Customer, also for the calls that `fn` makes asynchronously. Pass `undefined` for a
     * shopper without a Customer. The scope does not change the RequestContext, so other code that runs
     * at the same time for the same request does not see it.
     */
    runForCustomer<T>(ctx: RequestContext, customerId: ID | undefined, fn: () => Promise<T>): Promise<T> {
        return this.scope.run({ customerId }, fn);
    }

    /**
     * @description
     * Returns the ID of the Customer that the price is for, or `undefined` for a guest. Inside
     * `runForCustomer()` this runs no query. Otherwise it loads the Customer of the active User once
     * for each request.
     */
    async getCustomerId(ctx: RequestContext): Promise<ID | undefined> {
        const scope = this.scope.getStore();
        return scope ? scope.customerId : this.getActiveCustomerId(ctx);
    }

    /**
     * @description
     * Returns the Customer that the price is for, or `undefined` for a guest. Loads each Customer
     * once for each request. It gives only a Customer of the active Channel that is not deleted.
     */
    async getCustomer(ctx: RequestContext): Promise<Customer | undefined> {
        const customerId = await this.getCustomerId(ctx);
        if (customerId == null) {
            return undefined;
        }
        return this.requestCache.get(ctx, this.customerCacheKey(customerId), () =>
            this.customerService.findOne(ctx, customerId, ['user']),
        );
    }

    private getActiveCustomerId(ctx: RequestContext): Promise<ID | undefined> {
        const userId = ctx.activeUserId;
        if (userId == null) {
            return Promise.resolve(undefined);
        }
        return this.requestCache.get(ctx, `ShopperIdentityService.activeCustomerId(${userId})`, async () => {
            const customer = await this.customerService.findOneByUserId(ctx, userId);
            if (customer) {
                // getCustomer() then uses this Customer and runs no second query
                this.requestCache.set(ctx, this.customerCacheKey(customer.id), Promise.resolve(customer));
            }
            return customer?.id;
        });
    }

    private customerCacheKey(customerId: ID) {
        return `ShopperIdentityService.customer(${customerId})`;
    }
}
