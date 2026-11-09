import fs from 'fs/promises';
import os from 'os';
import path from 'path';

/*
 * The `vendure email` CLI commands. They are a thin client of the EmailPlugin's dev mode API, which the
 * running Vendure server mounts at `<dev mailbox route>/api`, so they use the project's real
 * configuration, plugins and database.
 *
 * Enable them by adding "@vendure/email-plugin" to `vendure.cli.plugins` in the project's package.json.
 *
 * The structural types below match the `CliPlugin` interface of `@vendure/cli`, which validates this
 * plugin when it loads it. They are declared here so that the EmailPlugin does not depend on the CLI.
 */

interface Option {
    long: string;
    short?: string;
    description: string;
    defaultValue?: unknown;
}

interface Command {
    name: string;
    description: string;
    arguments?: Array<{ name: string; description: string; required?: boolean }>;
    options?: Option[];
    action: (...args: any[]) => Promise<number | void>;
}

const EXIT_EMAIL_FAILED = 1;
const EXIT_UNREACHABLE = 2;

const commonOptions: Option[] = [
    {
        long: '--url <url>',
        description:
            'URL of the dev mailbox (the EmailPlugin devMode `route`). Defaults to $VENDURE_MAILBOX_URL or http://localhost:3000/mailbox',
    },
    {
        long: '--json',
        description: 'Print JSON. This is the default when the output is not a terminal, e.g. for agents',
    },
];

const emailOptions: Option[] = [
    { long: '-l, --language <code>', description: 'Language code of the email, e.g. de' },
    { long: '-c, --channel <code>', description: 'Channel code. Defaults to the default channel' },
    {
        long: '-a, --arg <key=value...>',
        description: 'Arguments for the sample event, e.g. --arg order=ABC123 or --arg email=jo@example.com',
    },
];

export const emailCliCommands: Command[] = [
    {
        name: 'list',
        description: 'List the configured email types and where their sample data comes from',
        options: commonOptions,
        action: async (...args) => {
            const options = readOptions(args);
            return run(options, async client => {
                const result = await client.get('/emails');
                print(options, result, () =>
                    result.emails
                        .map(
                            (e: any) =>
                                `${e.type.padEnd(28)} ${String(e.event).padEnd(36)} sample: ${e.sampleData}`,
                        )
                        .join('\n'),
                );
                return 0;
            });
        },
    },
    {
        name: 'render',
        description:
            'Render an email from sample data without sending it. Writes the HTML and text to files and prints their paths',
        arguments: [{ name: 'type', description: 'The email type, e.g. order-confirmation', required: true }],
        options: [
            ...commonOptions,
            ...emailOptions,
            {
                long: '-o, --out <dir>',
                description:
                    'Directory to write the .html and .txt files to. Defaults to <tmp>/vendure-emails',
            },
            { long: '--vars', description: 'Include the template variables in the output' },
        ],
        action: async (...args) => {
            const [type] = args as [string];
            const options = readOptions(args);
            return run(options, async client => {
                const result = await client.post('/render', toEmailRequest(type, options));
                if (!result.ok) {
                    return printFailure(options, result);
                }
                const outDir = options.out ?? path.join(os.tmpdir(), 'vendure-emails');
                await fs.mkdir(outDir, { recursive: true });
                const baseName = `${result.type}.${result.languageCode}`;
                const htmlPath = path.resolve(outDir, `${baseName}.html`);
                const textPath = path.resolve(outDir, `${baseName}.txt`);
                await fs.writeFile(htmlPath, result.email.html);
                await fs.writeFile(textPath, result.email.text ?? '');
                const { html, ...email } = result.email;
                const output = {
                    ok: true,
                    type: result.type,
                    languageCode: result.languageCode,
                    channelCode: result.channelCode,
                    sampleSource: result.sampleSource,
                    email: { ...email, htmlPath, textPath },
                    ...(options.vars ? { templateVars: result.templateVars } : {}),
                };
                print(options, output, () =>
                    [
                        `Subject:  ${email.subject}`,
                        `From:     ${email.from}`,
                        `To:       ${email.recipient}`,
                        `Template: ${email.templateKind} (from ${email.templateOrigin}), sample data from ${result.sampleSource}`,
                        `HTML:     ${htmlPath}`,
                        `Text:     ${textPath}`,
                    ].join('\n'),
                );
                return 0;
            });
        },
    },
    {
        name: 'send',
        description:
            'Send an email built from sample data through the real pipeline (filters, loadData, job queue, worker, transport) and wait for it in the outbox',
        arguments: [{ name: 'type', description: 'The email type, e.g. order-confirmation', required: true }],
        options: [
            ...commonOptions,
            ...emailOptions,
            { long: '--to <address>', description: 'Send to this address instead of the sample recipient' },
            {
                long: '-w, --wait <seconds>',
                description: 'Seconds to wait for the email to reach the outbox. 0 to not wait',
                defaultValue: '15',
            },
        ],
        action: async (...args) => {
            const [type] = args as [string];
            const options = readOptions(args);
            return run(options, async client => {
                const result = await client.post('/send', {
                    ...toEmailRequest(type, options),
                    to: options.to,
                    waitMs: Number(options.wait ?? 15) * 1000,
                });
                if (!result.ok) {
                    return printFailure(options, result);
                }
                print(options, result, () =>
                    result.entry
                        ? `Sent "${result.entry.subject}" to ${result.entry.recipient} (outbox id ${result.entry.id})`
                        : `Queued (correlation id ${result.correlationId})`,
                );
                return 0;
            });
        },
    },
    {
        name: 'outbox',
        description:
            'List emails the server tried to send in dev mode, newest first. Use --wait to wait for an email caused by an action you just took',
        options: [
            ...commonOptions,
            {
                long: '--since <time>',
                description: 'Only emails since an ISO date or a duration ago, e.g. 5m',
            },
            { long: '--to <address>', description: 'Only emails to, cc or bcc this address' },
            { long: '-t, --type <type>', description: 'Only emails of this type' },
            { long: '--status <status>', description: 'Only "sent" or "failed" emails' },
            {
                long: '-w, --wait <seconds>',
                description: 'Wait up to this many seconds for a matching email to appear',
            },
            { long: '--limit <n>', description: 'Maximum number of emails', defaultValue: '20' },
            { long: '--id <id>', description: 'Show one email, including its HTML and text' },
        ],
        action: async (...args) => {
            const options = readOptions(args);
            return run(options, async client => {
                if (options.id) {
                    const single = await client.get(`/outbox/${encodeURIComponent(options.id)}`);
                    if (!single.ok) {
                        return printFailure(options, single);
                    }
                    print(options, single, () => formatEntry(single.entry, true));
                    return 0;
                }
                const query = new URLSearchParams();
                for (const [key, value] of Object.entries({
                    since: options.since,
                    to: options.to,
                    type: options.type,
                    status: options.status,
                    limit: options.limit,
                    waitMs: options.wait ? String(Number(options.wait) * 1000) : undefined,
                })) {
                    if (value) {
                        query.set(key, value);
                    }
                }
                const result = await client.get(`/outbox?${query.toString()}`);
                if (!result.ok) {
                    return printFailure(options, result);
                }
                print(options, result, () =>
                    result.entries.length
                        ? result.entries.map((e: any) => formatEntry(e, false)).join('\n')
                        : 'No matching emails',
                );
                // When waiting for an email, not finding one is a failure the caller should notice.
                return options.wait && !result.entries.length ? EXIT_EMAIL_FAILED : 0;
            });
        },
    },
    {
        name: 'check',
        description:
            'Render every email type from sample data, in each given language, and fail if any template errors',
        options: [
            ...commonOptions,
            { long: '-l, --language <codes>', description: 'Comma-separated language codes, e.g. en,de' },
            { long: '-c, --channel <code>', description: 'Channel code. Defaults to the default channel' },
            { long: '-t, --type <types>', description: 'Comma-separated email types to check' },
        ],
        action: async (...args) => {
            const options = readOptions(args);
            return run(options, async client => {
                const result = await client.post('/check', {
                    languageCodes: splitList(options.language),
                    channelCode: options.channel,
                    types: splitList(options.type),
                });
                print(options, result, () =>
                    result.results
                        .map((r: any) => {
                            const status = r.skipped ? 'SKIP' : r.ok ? 'OK  ' : 'FAIL';
                            const detail = r.ok && !r.skipped ? r.subject : `[${r.stage}] ${r.error}`;
                            return `${status} ${r.type} (${r.languageCode ?? 'default'}): ${detail}`;
                        })
                        .join('\n'),
                );
                return result.ok ? 0 : EXIT_EMAIL_FAILED;
            });
        },
    },
];

/**
 * The CLI plugin which adds the `vendure email` commands.
 */
const emailCliPlugin = {
    id: '@vendure/email-plugin',
    commands: [
        {
            name: 'email',
            description:
                'Render, send and inspect the emails of a Vendure server running the EmailPlugin in dev mode',
            subcommands: emailCliCommands,
        },
    ],
};

export default emailCliPlugin;

type Options = Record<string, any>;

/**
 * Commander passes the parsed options third from the end of the action's arguments, followed by the
 * Command and the CLI's context object.
 */
function readOptions(args: unknown[]): Options {
    const options = args[args.length - 3];
    return options && typeof options === 'object' && !Array.isArray(options) ? (options) : {};
}

function toEmailRequest(type: string, options: Options) {
    const args: Record<string, string> = {};
    for (const pair of [].concat(options.arg ?? [])) {
        const [key, ...rest] = String(pair).split('=');
        args[key] = rest.join('=');
    }
    return { type, languageCode: options.language, channelCode: options.channel, args };
}

function splitList(value: string | undefined) {
    return value
        ? value
              .split(',')
              .map(v => v.trim())
              .filter(Boolean)
        : undefined;
}

function wantsJson(options: Options) {
    return options.json === true || !process.stdout.isTTY;
}

function print(options: Options, value: unknown, human: () => string) {
    process.stdout.write((wantsJson(options) ? JSON.stringify(value, null, 2) : human()) + '\n');
}

function printFailure(options: Options, result: any): number {
    if (wantsJson(options)) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } else {
        process.stderr.write(`Failed at stage "${String(result.stage)}": ${String(result.error)}\n`);
        if (result.stack) {
            process.stderr.write(`${String(result.stack)}\n`);
        }
    }
    return EXIT_EMAIL_FAILED;
}

function formatEntry(entry: any, full: boolean) {
    const head = `${String(entry.sentAt)} ${entry.status === 'sent' ? 'SENT  ' : 'FAILED'} ${String(entry.type)} to ${String(
        entry.recipient,
    )}: ${String(entry.subject ?? '')}${entry.error ? ` (${String(entry.error.message)})` : ''} [${String(entry.id)}]`;
    return full ? `${head}\n\n${String(entry.text ?? '')}` : head;
}

interface Client {
    get(pathname: string): Promise<any>;
    post(pathname: string, body: unknown): Promise<any>;
}

async function run(options: Options, fn: (client: Client) => Promise<number>): Promise<number> {
    const baseUrl = String(options.url ?? process.env.VENDURE_MAILBOX_URL ?? 'http://localhost:3000/mailbox')
        .replace(/\/+$/, '')
        .concat('/api');
    const request = async (pathname: string, init?: RequestInit) => {
        let response: Response;
        try {
            response = await fetch(baseUrl + pathname, init);
        } catch (e: any) {
            throw new UnreachableError(
                `Could not reach the EmailPlugin dev API at ${baseUrl} (${String(e?.cause?.code ?? e?.message)}). ` +
                    'Is the Vendure server running, with the EmailPlugin in devMode? Use --url to point at its dev mailbox route.',
            );
        }
        const contentType = response.headers.get('content-type') ?? '';
        if (!contentType.includes('application/json')) {
            throw new UnreachableError(
                `${baseUrl + pathname} did not return JSON (HTTP ${response.status}). ` +
                    'Is the EmailPlugin running in devMode, and is --url the dev mailbox route?',
            );
        }
        return response.json();
    };
    const client: Client = {
        get: pathname => request(pathname),
        post: (pathname, body) =>
            request(pathname, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(body),
            }),
    };
    try {
        return await fn(client);
    } catch (e: any) {
        const unreachable = e instanceof UnreachableError;
        if (wantsJson(options)) {
            process.stdout.write(
                JSON.stringify(
                    { ok: false, stage: unreachable ? 'connect' : 'cli', error: e.message },
                    null,
                    2,
                ) + '\n',
            );
        } else {
            process.stderr.write(`${String(e.message)}\n`);
        }
        return unreachable ? EXIT_UNREACHABLE : EXIT_EMAIL_FAILED;
    }
}

class UnreachableError extends Error {}
