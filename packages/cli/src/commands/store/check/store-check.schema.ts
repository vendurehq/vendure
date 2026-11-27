import { z } from 'zod';

const fix = z.object({
    path: z.array(z.string()).describe('The MCP admin tool to call, such as admin_create_tax_rate'),
    input: z.unknown().describe('The arguments of the tool call'),
    description: z.string(),
});

const finding = z.object({
    code: z.string().describe('A namespaced code, such as store.tax.no-rate'),
    severity: z.enum(['ERROR', 'WARNING']),
    message: z.string(),
    channelId: z.string().nullable().optional(),
    zoneId: z.string().nullable().optional(),
    countryCode: z.string().nullable().optional(),
    taxCategoryId: z.string().nullable().optional(),
    fixes: z.array(fix),
    dashboardUrl: z
        .string()
        .nullable()
        .optional()
        .describe('A Dashboard path that shows what the finding is about, such as /tax-rates'),
});

export const input = z.object({});

export const output = z.object({
    ready: z.boolean().describe('False when any finding has the severity ERROR'),
    findings: z.array(finding),
    dashboard: z
        .string()
        .optional()
        .describe('The Dashboard URL of the dev server, which the dashboardUrl paths are relative to'),
});

export type StoreCheckOutput = z.infer<typeof output>;
export type StoreCheckFinding = z.infer<typeof finding>;
