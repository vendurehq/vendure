import { z } from 'zod';

export const input = z.object({
    cloudProject: z.string().optional().describe('The Console Project to deploy previews to'),
});
