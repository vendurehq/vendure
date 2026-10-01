import { z } from 'zod';

/**
 * @description
 * A Zod string schema capped at 255 characters, the size of Vendure's usual `varchar(255)`
 * columns. Use it for names, codes and other short text.
 *
 * @docsCategory core plugins/McpPlugin
 * @since 3.8.0
 */
export const shortText = z.string().max(255);

/**
 * @description
 * A Zod string schema capped at 10000 characters. Use it for text such as descriptions and
 * notes.
 *
 * @docsCategory core plugins/McpPlugin
 * @since 3.8.0
 */
export const longText = z.string().max(10000);
