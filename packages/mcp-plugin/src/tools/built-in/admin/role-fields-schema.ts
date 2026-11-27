import { longText, shortText } from '@vendure/mcp-sdk';
import { z } from 'zod';

/** The most permissions one role takes; core and plugins define well under this many. */
const MAX_ROLE_PERMISSIONS = 500;

/** Fields shared by create_role and update_role. Update makes them all optional. */
export const roleFieldsSchema = z.strictObject({
    code: shortText.describe('Unique role code, e.g. "catalog-editor".'),
    description: longText.describe('What the role is for.'),
    // A string list rather than the Permission enum, so permissions that plugins define are accepted
    // too. Core refuses a name it does not know.
    permissions: z
        .array(shortText)
        .max(MAX_ROLE_PERMISSIONS)
        .describe(
            'Permission names, e.g. ["ReadCatalog", "UpdateCatalog"]. You can only grant permissions you hold yourself.',
        ),
});
