import { CreateCustomerInput, SetCustomerForOrderResult } from '@vendure/common/lib/generated-shop-types';

import { RequestContext } from '../../api/common/request-context';
import { ErrorResultUnion } from '../../common/error/error-result';
import { InjectableStrategy } from '../../common/types/injectable-strategy';
import { Customer } from '../../entity/customer/customer.entity';
import { Order } from '../../entity/order/order.entity';

/**
 * @description
 * A strategy that determines how to deal with guest checkouts - i.e. when a customer
 * checks out without being logged in. For example, a strategy could be used to implement
 * business rules such as:
 *
 * - No guest checkouts allowed
 * - No guest checkouts allowed for customers who already have an account
 * - No guest checkouts allowed for customers who have previously placed an order
 * - Allow guest checkouts, but create a new Customer entity if the email address
 *   is already in use
 * - Allow guest checkouts, but update the existing Customer entity if the email address
 *   is already in use
 *
 * :::info
 *
 * This is configured via the `orderOptions.guestCheckoutStrategy` property of
 * your VendureConfig.
 *
 * :::
 *
 * @docsCategory orders
 * @since 2.0.0
 */
export interface GuestCheckoutStrategy extends InjectableStrategy {
    /**
     * @description
     * This method is called when the `setCustomerForOrder` mutation is executed.
     * It should return either a Customer object or an ErrorResult.
     */
    setCustomerForOrder(
        ctx: RequestContext,
        order: Order,
        input: CreateCustomerInput,
    ):
        | ErrorResultUnion<SetCustomerForOrderResult, Customer>
        | Promise<ErrorResultUnion<SetCustomerForOrderResult, Customer>>;
}
