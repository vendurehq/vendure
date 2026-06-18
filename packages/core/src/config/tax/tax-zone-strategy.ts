import { RequestContext } from '../../api/common/request-context';
import { InjectableStrategy } from '../../common/types/injectable-strategy';
import { Channel, Order, Zone } from '../../entity';

/**
 * @description
 * Defines how the active {@link Zone} is determined for the purposes of calculating taxes.
 *
 * This strategy is used in 2 scenarios:
 *
 * 1. To determine the applicable Zone when calculating the taxRate to apply when displaying ProductVariants. In this case the
 * `order` argument will be undefined, as the request is not related to a specific Order.
 * 2. To determine the applicable Zone when calculating the taxRate on the contents of a specific Order. In this case the
 * `order` argument _will_ be defined, and can be used in the logic. For example, the shipping address can be taken into account.
 *
 * Note that this method is called very often in a typical user session, so any work it performs should be designed with as little
 * performance impact as possible.
 *
 * :::info
 *
 * This is configured via the `taxOptions.taxZoneStrategy` property of
 * your VendureConfig.
 *
 * :::
 *
 * @docsCategory tax
 */
export interface TaxZoneStrategy extends InjectableStrategy {
    determineTaxZone(
        ctx: RequestContext,
        zones: Zone[],
        channel: Channel,
        order?: Order,
    ): Zone | Promise<Zone> | undefined;
}
