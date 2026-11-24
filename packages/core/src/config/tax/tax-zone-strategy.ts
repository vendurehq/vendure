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
 * The strategy can also choose the country whose country {@link TaxRate}s apply, by implementing the
 * optional `determineTaxCountryCode()` method. By default this is the country of the shipping address,
 * see {@link defaultTaxCountryCode}.
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
    /**
     * @description
     * Returns the active tax Zone. The zone rate of this Zone applies when no country rate does.
     */
    determineTaxZone(
        ctx: RequestContext,
        zones: Zone[],
        channel: Channel,
        order?: Order,
    ): Zone | Promise<Zone> | undefined;

    /**
     * @description
     * Returns the country code used to look up country {@link TaxRate}s. A country rate for this
     * country wins over the zone rate of `activeTaxZone`, which is the Zone that `determineTaxZone()`
     * returned for the same calculation. Return `undefined` to apply no country rate, so that only
     * the zone rate of `activeTaxZone` applies, then the 0% default.
     *
     * When this method is not implemented, {@link defaultTaxCountryCode} is used, which returns the
     * country of the shipping address. A strategy can call that function to keep the default for
     * some cases.
     *
     * As with `determineTaxZone()`, `order` is undefined when a price is calculated outside an
     * Order, for example on a product page or in the search index. The result is recorded on the
     * Order as `Order.taxCountryCode`, and when it changes, every OrderLine is priced and taxed
     * again.
     *
     * Like `determineTaxZone()`, this method is called very often, and its result is not cached.
     * A strategy that does expensive work should cache it itself.
     *
     * @example
     * ```ts
     * // B2B reverse charge: no VAT for business customers, the default rules for everyone else.
     * export class ReverseChargeTaxZoneStrategy implements TaxZoneStrategy {
     *     determineTaxZone(ctx: RequestContext, zones: Zone[], channel: Channel, order?: Order) {
     *         if (isBusinessCustomer(order)) {
     *             return zones.find(zone => zone.name === 'Reverse charge');
     *         }
     *         return channel.defaultTaxZone;
     *     }
     *
     *     determineTaxCountryCode(ctx: RequestContext, channel: Channel, activeTaxZone: Zone, order?: Order) {
     *         if (isBusinessCustomer(order)) {
     *             // No country rate, so the 0% zone rate of the 'Reverse charge' Zone applies
     *             return undefined;
     *         }
     *         return defaultTaxCountryCode(channel, activeTaxZone, order);
     *     }
     * }
     * ```
     *
     * @since 4.0.0
     */
    determineTaxCountryCode?(
        ctx: RequestContext,
        channel: Channel,
        activeTaxZone: Zone,
        order?: Order,
    ): string | undefined | Promise<string | undefined>;
}
