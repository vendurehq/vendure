import { z } from 'zod';

export const input = z.object({});

export const output = z.object({ deleted: z.string() });
