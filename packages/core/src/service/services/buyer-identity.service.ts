import { Injectable } from '@nestjs/common';
import { ID } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../api/common/request-context';
import { RequestContextCacheService } from '../../cache/request-context-cache.service';
import { Buyer } from '../../config/catalog/product-variant-buyer-price-strategy';
import { Customer } from '../../entity/customer/customer.entity';

import { CustomerService } from './customer.service';

/**
 * @description
 * Creates the {@link Buyer} that Vendure passes to the {@link ProductVariantBuyerPriceStrategy} in the
 * `buyer` argument. A Buyer loads nothing until a strategy calls one of its methods.
 *
 * * `forCustomer()` gives the Buyer for a known Customer ID, for example the Customer of an Order.
 *   `ProductVariantService.calculateBuyerPriceForOrder()` uses it with the Customer of the Order. In an
 *   Admin draft order this is the Customer, not the Administrator, and in a guest Order it is the guest
 *   Customer.
 * * `forActiveUser()` gives the Buyer for the Customer of the active User, or no Customer for a guest
 *   session. The Shop API `ProductVariant.buyerPrice` field uses it.
 *
 * The service loads each Customer once for each request, so a strategy can call the Buyer for each
 * OrderLine without a query for each line. It gives only a Customer of the active Channel that is not
 * deleted.
 *
 * @docsCategory services
 * @since 4.0.0
 */
@Injectable()
export class BuyerIdentityService {
    constructor(
        private requestCache: RequestContextCacheService,
        private customerService: CustomerService,
    ) {}

    /**
     * @description
     * Returns the Buyer for the given Customer ID. Pass `undefined` or `null` for a buyer without a
     * Customer. For a Customer that is deleted or not in the active Channel, `getCustomerId()` and
     * `getCustomer()` both give `undefined`. So `getCustomerId()` loads the Customer too: one query
     * for each Customer and request, shared with `getCustomer()`.
     */
    forCustomer(ctx: RequestContext, customerId: ID | null | undefined): Buyer {
        const id = customerId ?? undefined;
        return {
            getCustomerId: async () => (await this.getCustomer(ctx, id))?.id,
            getCustomer: () => this.getCustomer(ctx, id),
        };
    }

    /**
     * @description
     * Returns the Buyer for the Customer of the active User. For a guest session, the Buyer has no
     * Customer.
     */
    forActiveUser(ctx: RequestContext): Buyer {
        return {
            getCustomerId: () => this.getActiveCustomerId(ctx),
            getCustomer: async () => this.getCustomer(ctx, await this.getActiveCustomerId(ctx)),
        };
    }

    private getCustomer(ctx: RequestContext, customerId: ID | undefined): Promise<Customer | undefined> {
        if (customerId == null) {
            return Promise.resolve(undefined);
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
        return this.requestCache.get(ctx, `BuyerIdentityService.activeCustomerId(${userId})`, async () => {
            const customer = await this.customerService.findOneByUserId(ctx, userId);
            if (customer) {
                // getCustomer() then uses this Customer and runs no second query
                this.requestCache.set(ctx, this.customerCacheKey(customer.id), Promise.resolve(customer));
            }
            return customer?.id;
        });
    }

    private customerCacheKey(customerId: ID) {
        return `BuyerIdentityService.customer(${customerId})`;
    }
}
