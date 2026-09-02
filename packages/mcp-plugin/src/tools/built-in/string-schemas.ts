import { z } from 'zod';

/**
 * Length caps for free-text inputs, so an oversized value is refused before it reaches the
 * database. `shortText` matches Vendure's usual `varchar(255)` columns; `longText` is for the few
 * fields backed by a text column.
 */
export const shortText = z.string().max(255);

export const longText = z.string().max(10000);
