import { COMMAND_EXIT_CODES, defineError } from '@vendure/common/lib/command';

import { RequestContext } from '../../../api/common/request-context';
import { TaxRateService, ZoneTaxRateOverlap } from '../../services/tax-rate.service';

import { StoreReadinessFinding, toFinding } from './store-readiness-types';

export const ambiguousZoneRates = defineError<ZoneTaxRateOverlap>({
    code: 'store.tax.ambiguous-zone-rates',
    exit: COMMAND_EXIT_CODES.failed,
    message: ({ countryCode, taxRates }) =>
        `${countryCode} has no country rate and matches ${taxRates.length} zone rates of one tax category ` +
        `(${taxRates.map(rate => `"${rate.name}"`).join(', ')}). Which one applies depends on the tax zone strategy.`,
    fix: ({ countryCode, taxCategoryId }) => [
        {
            path: ['admin_create_tax_rate'],
            input: {
                input: { name: `${countryCode} rate`, taxCategoryId, target: { countryCode } },
            },
            description: `Add a rate for ${countryCode} itself, with its percentage as "value". A country rate wins over zone rates.`,
        },
    ],
});

/** No country matches two zone rates of one tax category without a country rate of its own. */
export async function checkTaxRateOverlaps(
    ctx: RequestContext,
    taxRateService: TaxRateService,
): Promise<StoreReadinessFinding[]> {
    const overlaps = await taxRateService.findOverlappingZoneRates(ctx);
    return overlaps.map(overlap =>
        toFinding(ambiguousZoneRates, 'warning', overlap, {
            countryCode: overlap.countryCode,
            taxCategoryId: overlap.taxCategoryId,
            dashboardUrl: '/tax-rates',
        }),
    );
}
