import { OrderRecalculationStrategy } from './order-recalculation-strategy';

/**
 * @description
 * The default {@link OrderRecalculationStrategy} which never triggers a read-time recalculation.
 * This preserves the behaviour of Vendure prior to v3.8.0, where an active Order's prices are only
 * re-calculated on write mutations.
 *
 * @docsCategory orders
 * @docsPage OrderRecalculationStrategy
 * @since 3.8.0
 */
export class NoOrderRecalculationStrategy implements OrderRecalculationStrategy {
    shouldRecalculate(): boolean {
        return false;
    }
}
