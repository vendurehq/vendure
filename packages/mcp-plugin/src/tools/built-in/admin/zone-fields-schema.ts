import { shortText } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { countryCodesSchema } from './setup-schemas';

/** One input shape for create_zone and update_zone. Update makes both fields optional. */
export const zoneFieldsSchema = z.strictObject({
    name: shortText.describe('Zone name, e.g. "Europe".'),
    memberCountryCodes: countryCodesSchema
        .describe('Codes of the countries in the zone. On update, the list replaces the current members.')
        .optional(),
});
