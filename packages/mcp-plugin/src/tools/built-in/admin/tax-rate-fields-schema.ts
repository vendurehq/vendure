import { CountryService, ID, RequestContext } from '@vendure/core';
import { idSchema, shortText } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { findCountriesByCode } from './country-lookup';
import { countryCodeSchema } from './setup-schemas';

/** A rate applies to one country, or to every country of a zone. A country rate wins over a zone rate. */
export const taxRateTargetSchema = z.union([
    z.strictObject({ countryCode: countryCodeSchema.describe('The country the rate applies to.') }),
    z.strictObject({ zoneId: idSchema.describe('The zone the rate applies to.') }),
]);

export type TaxRateTarget = z.infer<typeof taxRateTargetSchema>;

/** Fields shared by create_tax_rate and update_tax_rate. Update makes them all optional. */
export const taxRateFieldsSchema = z.strictObject({
    name: shortText.describe('Rate name, e.g. "Standard UK".'),
    value: z.number().min(0).max(999.99).describe('The rate as a percentage, e.g. 20 for 20%.'),
    enabled: z.boolean().describe('Whether the rate is used. Defaults to true on create.').optional(),
    taxCategoryId: idSchema.describe('The tax category the rate is for.'),
    target: taxRateTargetSchema.describe(
        'Where the rate applies: { "countryCode": "GB" } or { "zoneId": "1" }.',
    ),
    customerGroupId: idSchema
        .describe('Limit the rate to customers in this group. Leave out for every customer.')
        .optional(),
});

/**
 * Turns a tool target into core's `zoneId` or `regionId`. Only one is returned: on update, core
 * clears the other target when one is set.
 */
export async function resolveTaxRateTarget(
    ctx: RequestContext,
    countryService: CountryService,
    target: TaxRateTarget,
): Promise<{ zoneId: ID } | { regionId: ID }> {
    if ('zoneId' in target) {
        return { zoneId: target.zoneId };
    }
    const [country] = await findCountriesByCode(ctx, countryService, [target.countryCode]);
    return { regionId: country.id };
}
