import { z } from 'zod';

// Narrows a plain string to a specific string type at compile time, without affecting
// runtime validation. The published JSON schema still uses `type: "string"` and accepts
// any string, while the Vendure service expects types such as LanguageCode or GlobalFlag.
// Without this, z.infer produces `string`, forcing each call site to add its own cast.
// The schema object itself is returned unchanged.
export function enumString<T extends string>(schema: z.ZodString): z.ZodType<T> {
    return schema as unknown as z.ZodType<T>;
}
