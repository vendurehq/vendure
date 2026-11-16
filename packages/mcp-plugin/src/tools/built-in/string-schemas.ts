import { z } from 'zod';

export function enumString<T extends string>(schema: z.ZodString): z.ZodType<T> {
    return schema as unknown as z.ZodType<T>;
}
