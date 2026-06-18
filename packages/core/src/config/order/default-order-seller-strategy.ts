import { OrderSellerStrategy } from './order-seller-strategy';

/**
 * @description
 * The DefaultOrderSellerStrategy treats the Order as single-vendor.
 *
 * @since 2.0.0
 * @docsCategory orders
 * @docsPage OrderSellerStrategy
 */
export class DefaultOrderSellerStrategy implements OrderSellerStrategy {
    // By default, Orders will not get split.
}
