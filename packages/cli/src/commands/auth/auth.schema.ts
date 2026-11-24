import { z } from 'zod';

const organizationInput = z
    .string()
    .optional()
    .describe(
        'Sign in to this organization: its Account identifier (Vendure Console → Settings) or its name, ignoring case',
    );

const user = z.object({
    id: z.string(),
    email: z.string(),
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
});

const organization = z.object({
    workosOrganizationId: z.string(),
    customerAccountId: z.string().nullable().describe("Console's Account identifier, when known"),
    name: z.string().nullable(),
});

const pending = z.object({
    status: z.literal('pending'),
    url: z.string().describe('Where the person approves the login, with the code filled in'),
    code: z.string().describe('The code the person confirms in the browser'),
    expiresAt: z.string().describe('When the code expires, as an ISO time'),
});

const loggedIn = z.object({
    loggedIn: z.literal(true),
    consoleApiUrl: z.string().describe('The Vendure Console API the login is for'),
    user,
    organization: organization.nullable().describe('The organization the login is scoped to'),
});

const renewalError = z.object({
    message: z.string(),
    code: z.string().optional(),
    status: z.number().optional(),
});

export const login = {
    input: z.object({ organization: organizationInput }),
    output: z.union([pending, loggedIn]),
};

export const wait = {
    input: z.object({
        timeout: z
            .number()
            .positive()
            .optional()
            .describe(
                'How many seconds to wait for approval. Defaults to 30 when called as an MCP tool, and ' +
                    'otherwise to the rest of the code lifetime',
            ),
    }),
    output: z.union([pending, loggedIn]),
};

export const status = {
    input: z.object({}),
    output: z.object({
        loggedIn: z.boolean(),
        consoleApiUrl: z.string(),
        path: z.string().describe('Where the login is stored'),
        clientId: z.string().optional().describe('The WorkOS client that issued the login'),
        user: user.optional(),
        organization: organization.nullable().optional(),
        accessTokenExpiresAt: z
            .number()
            .optional()
            .describe('When the access token expires, as epoch milliseconds. It is renewed automatically'),
        renewable: z
            .boolean()
            .optional()
            .describe(
                'True when the login was renewed, false when it can no longer be renewed. Absent when the check could not finish',
            ),
        renewalError: renewalError.optional(),
        otherConsoleLogin: z
            .boolean()
            .optional()
            .describe('True when the stored login is for another Vendure Console'),
    }),
};

export const logout = {
    input: z.object({}),
    output: z.object({
        removed: z.boolean().describe('Whether a login was stored on this machine. It is gone either way'),
        sessionEnded: z
            .boolean()
            .describe('Whether Vendure Console ended the session, so copies of the login stop working too'),
    }),
};

export type PendingLoginOutput = z.infer<typeof pending>;
export type LoggedInOutput = z.infer<typeof loggedIn>;
export type LoginOutput = z.infer<typeof login.output>;
export type StatusOutput = z.infer<typeof status.output>;
export type LogoutOutput = z.infer<typeof logout.output>;
