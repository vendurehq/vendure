import { z } from 'zod';

// Vendure IDs can be a string or a number depending on the project's ID strategy, so accept both.
export const idSchema = z.union([z.string(), z.number()], {
    error: 'must be a Vendure entity id (a string or a number)',
});

// Upper bound on the IDs one input list may carry, so a runaway list cannot become a huge query.
export const MAX_ID_LIST_LENGTH = 100;
