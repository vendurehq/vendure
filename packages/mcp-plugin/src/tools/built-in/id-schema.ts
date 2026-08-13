import { z } from 'zod';

// Vendure IDs are `string | number` (core's ID type — which one depends on the project's
// EntityIdStrategy), so tool inputs must accept both.
export const idSchema = z.union([z.string(), z.number()]);
