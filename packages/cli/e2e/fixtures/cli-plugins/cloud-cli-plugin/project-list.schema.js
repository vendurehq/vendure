import { z } from 'zod';

export const input = z.object({});

export const output = z.object({ projects: z.array(z.string()) });
