import { CreateCustomerInput, SetCustomerForOrderResult } from '@vendure/common/lib/generated-shop-types';

import { RequestContext } from '../../api/common/request-context';
import { ErrorResultUnion } from '../../common/error/error-result';
import { AlreadyLoggedInError, GuestCheckoutError } from '../../common/error/generated-graphql-shop-errors';
import { Injector } from '../../common/injector';
import { Customer, Order } from '../../entity/index';
import { CustomerService } from '../../service/services/customer.service';

import { GuestCheckoutStrategy } from './guest-checkout-strategy';

/**
 * @description
 * Options available for the {@link DefaultGuestCheckoutStrategy}.
 *
 * @docsCategory orders
 * @docsPage DefaultGuestCheckoutStrategy
 * @since 2.0.0
 */
export interface DefaultGuestCheckoutStrategyOptions {
    /**
     * @description
     * Whether to allow guest checkouts.
     *
     * @default true
     */
    allowGuestCheckouts?: boolean;
    /**
     * @description
     * Whether to allow guest checkouts for customers who already have an account.
     * Note that when this is enabled, the details provided in the `CreateCustomerInput`
     * will overwrite the existing customer details of the registered customer.
     *
     * @default false
     */
    allowGuestCheckoutForRegisteredCustomers?: boolean;
}

/**
 * @description
 * The default implementation of the {@link GuestCheckoutStrategy}. This strategy allows
 * guest checkouts by default, but can be configured to disallow them.
 *
 * @example
 * ```ts
 * import { DefaultGuestCheckoutStrategy, VendureConfig } from '\@vendure/core';
 *
 * export const config: VendureConfig = {
 *   orderOptions: {
 *     guestCheckoutStrategy: new DefaultGuestCheckoutStrategy({
 *       allowGuestCheckouts: false,
 *       allowGuestCheckoutForRegisteredCustomers: false,
 *     }),
 *   },
 *   // ...
 * };
 * ```
 *
 * @docsCategory orders
 * @docsPage DefaultGuestCheckoutStrategy
 * @docsWeight 0
 * @since 2.0.0
 */
export class DefaultGuestCheckoutStrategy implements GuestCheckoutStrategy {
    private customerService: CustomerService;
    private readonly options: Required<DefaultGuestCheckoutStrategyOptions> = {
        allowGuestCheckouts: true,
        allowGuestCheckoutForRegisteredCustomers: false,
    };
    init(injector: Injector) {
        this.customerService = injector.get(CustomerService);
    }

    constructor(options?: DefaultGuestCheckoutStrategyOptions) {
        this.options = {
            ...this.options,
            ...(options ?? {}),
        };
    }
    async setCustomerForOrder(
        ctx: RequestContext,
        order: Order,
        input: CreateCustomerInput,
    ): Promise<ErrorResultUnion<SetCustomerForOrderResult, Customer>> {
        if (!this.options.allowGuestCheckouts) {
            return new GuestCheckoutError({ errorDetail: 'Guest checkouts are disabled' });
        }
        if (ctx.activeUserId) {
            return new AlreadyLoggedInError();
        }
        const errorOnExistingUser = !this.options.allowGuestCheckoutForRegisteredCustomers;
        const customer = await this.customerService.createOrUpdate(ctx, input, errorOnExistingUser);
        return customer;
    }
}
