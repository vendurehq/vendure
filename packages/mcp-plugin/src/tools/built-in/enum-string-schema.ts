import { z } from 'zod';

// Narrows a plain string to a specific string type at compile time only. For fields such as
// OrderState whose legal values are open and so cannot be published as an enum: the JSON schema
// stays `type: "string"`. Without this, z.infer produces `string` and every call site needs a
// cast. The schema object is returned unchanged.
export function enumString<T extends string>(schema: z.ZodString): z.ZodType<T> {
    return schema as unknown as z.ZodType<T>;
}
