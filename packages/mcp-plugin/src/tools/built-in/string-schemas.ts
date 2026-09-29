import { z } from 'zod';

// Caps free-text inputs so an oversized value is refused before it reaches the database.
// shortText matches Vendure's usual varchar(255) columns; longText is for text columns.
export const shortText = z.string().max(255);

export const longText = z.string().max(10000);

export function enumString<T extends string>(schema: z.ZodString): z.ZodType<T> {
    return schema as unknown as z.ZodType<T>;
}
