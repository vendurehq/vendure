import { z } from 'zod';

// Vendure IDs are `string | number` (core's ID type — which one depends on the project's
// EntityIdStrategy), so tool inputs must accept both.
export const idSchema = z.union([z.string(), z.number()]);

// Upper bound on the IDs one input list may carry, so a runaway list cannot become a huge query.
export const MAX_ID_LIST_LENGTH = 100;
