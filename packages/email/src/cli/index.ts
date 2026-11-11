import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/*
 * The `vendure email` CLI commands. They are a thin client of the EmailPlugin's dev mode API, which the
 * running Vendure server mounts at `<dev mailbox route>/api`, so they use the project's real
 * configuration, plugins and database.
 *
 * Enable them by adding "@vendure/email" to `vendure.cli.plugins` in the project's package.json.
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
                print(options, result, () => formatEmailList(result.emails));
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
            {
                long: '-p, --preview',
                description:
                    'Print a URL that serves the rendered email from live data, and open it in the browser when run ' +
                    'in a terminal. Screenshot it at 600px and 375px wide to check the layout',
            },
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
                const previewUrl = options.preview
                    ? previewUrlFor(options, type, result.languageCode, toEmailRequest(type, options).args)
                    : undefined;
                const output = {
                    ...(previewUrl ? { previewUrl } : {}),
                    ok: true,
                    type: result.type,
                    languageCode: result.languageCode,
                    channelCode: result.channelCode,
                    sampleArgs: result.sampleArgs,
                    email: { ...email, htmlPath, textPath },
                    ...(options.vars ? { templateVars: result.templateVars } : {}),
                };
                print(options, output, () =>
                    [
                        `Subject:  ${email.subject}`,
                        `From:     ${email.from}`,
                        `To:       ${email.recipient}`,
                        `Template: ${email.templateOrigin}`,
                        ...storedContentLine(email.contentOrigins),
                        ...storedDesignLine(email.designOrigins),
                        `HTML:     ${htmlPath}`,
                        `Text:     ${textPath}`,
                        ...(previewUrl ? [`Preview:  ${previewUrl}`] : []),
                    ].join('\n'),
                );
                // Agents get JSON and use the URL themselves; a person in a terminal wants to see it.
                if (previewUrl && !wantsJson(options)) {
                    openInBrowser(previewUrl);
                }
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
                // When waiting for an email, not finding one is a failure the caller should notice.
                if (options.wait && !result.entries.length) {
                    return printFailure(options, {
                        ok: false,
                        stage: 'queue',
                        error:
                            `No matching email arrived within ${options.wait}s. ` +
                            'Is a Vendure worker running, and did the action send an email?',
                        entries: [],
                    });
                }
                print(options, result, () =>
                    result.entries.length
                        ? result.entries.map((e: any) => formatEntry(e, false)).join('\n')
                        : 'No matching emails',
                );
                return 0;
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
                            let status = 'FAIL';
                            if (r.skipped) {
                                status = 'SKIP';
                            } else if (r.ok) {
                                status = 'OK  ';
                            }
                            const detail = r.ok && !r.skipped ? r.subject : `[${r.stage}] ${r.error}`;
                            return `${status} ${r.type} (${r.languageCode ?? 'default'}): ${detail}`;
                        })
                        .join('\n'),
                );
                return result.ok ? 0 : EXIT_EMAIL_FAILED;
            });
        },
    },
    {
        name: 'eject',
        description:
            'Copy a default email into the project (src/email/<type>/) to edit it. The definition keeps the package defaults for everything but the template',
        arguments: [{ name: 'type', description: 'The email type, e.g. order-shipped', required: true }],
        options: [
            { long: '--dir <dir>', description: 'Directory to write to', defaultValue: 'src/email' },
            { long: '--force', description: 'Overwrite existing files' },
            { long: '--json', description: 'Print JSON' },
        ],
        action: async (...args) => {
            const [type] = args as [string];
            const options = readOptions(args);
            try {
                const result = await ejectTemplate(type, options.dir ?? 'src/email', !!options.force);
                print(options, { ok: true, ...result }, () =>
                    [
                        `Wrote ${result.files.join(' and ')}`,
                        '',
                        `Next: in vendure-config.ts, replace ${result.definitionExport} in the EmailPlugin \`emails\` list with:`,
                        `    import { ${result.definitionExport} } from '${result.importPath}';`,
                    ].join('\n'),
                );
                return 0;
            } catch (e: any) {
                return printFailure(options, { ok: false, stage: 'eject', error: e.message });
            }
        },
    },
];

/**
 * The CLI plugin which adds the `vendure email` commands.
 */
const emailCliPlugin = {
    id: '@vendure/email',
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
/** One line per email for `vendure email list`, from the dev API's `/emails` response. */
export function formatEmailList(
    emails: Array<{
        type: string;
        label: string;
        event: string;
        hasSample: boolean;
        canSendFromOrder: boolean;
    }>,
): string {
    return emails
        .map(e => {
            const flags = [e.canSendFromOrder ? 'order page' : '', e.hasSample ? '' : '(no sample)'].filter(
                Boolean,
            );
            return `${e.type.padEnd(24)} ${e.label.padEnd(30)} ${e.event.padEnd(34)} ${flags.join(' ')}`.trimEnd();
        })
        .join('\n');
}

function readOptions(args: unknown[]): Options {
    const options = args[args.length - 3];
    return options && typeof options === 'object' && !Array.isArray(options) ? options : {};
}

function toEmailRequest(type: string, options: Options) {
    const args: Record<string, string> = {};
    for (const pair of [options.arg ?? []].flat()) {
        const [key, ...rest] = String(pair).split('=');
        args[key] = rest.join('=');
    }
    return { type, languageCode: options.language, channelCode: options.channel, args };
}

function storedContentLine(origins: Record<string, string> | undefined): string[] {
    const stored = Object.entries(origins ?? {}).filter(
        ([, origin]) => origin === 'channel' || origin === 'all-channels',
    );
    if (!stored.length) {
        return [];
    }
    // Text stored in the Dashboard beats the template's default text, so editing the .tsx default has no effect on these.
    const slots = stored.map(([name, origin]) => `${name} (${origin})`).join(', ');
    return [`Edited:   in the Dashboard: ${slots}`];
}

function storedDesignLine(origins: Record<string, string> | undefined): string[] {
    const names = Object.keys(origins ?? {});
    // The design set in the Dashboard beats `branding` in code, so editing that has no effect on these.
    return names.length ? [`Design:   in the Dashboard: ${names.join(', ')}`] : [];
}

function mailboxUrl(options: Options) {
    return String(options.url ?? process.env.VENDURE_MAILBOX_URL ?? 'http://localhost:3000/mailbox').replace(
        /\/$/,
        '',
    );
}

function previewUrlFor(options: Options, type: string, languageCode: string, args: Record<string, string>) {
    const query = new URLSearchParams({ ...args, language: languageCode });
    if (options.channel) {
        query.set('channel', options.channel);
    }
    return `${mailboxUrl(options)}/preview/${encodeURIComponent(type)}/html?${query.toString()}`;
}

/** The types of the default emails, which `eject` can copy. */
export async function defaultEmailTypes(): Promise<string[]> {
    const emailsDir = path.join(packageRoot(), 'src/emails');
    const entries = await fs.readdir(emailsDir, { withFileTypes: true });
    return entries
        .filter(e => e.isDirectory() && existsSync(path.join(emailsDir, e.name, 'template.tsx')))
        .map(e => e.name);
}

function packageRoot() {
    // lib/cli when built, src/cli when run from source
    for (const candidate of [path.join(__dirname, '../..')]) {
        if (existsSync(path.join(candidate, 'src/emails'))) {
            return candidate;
        }
    }
    throw new Error('Could not find the @vendure/email template sources (src/emails)');
}

/**
 * Copies a default email's template into the project and writes a definition that spreads the package
 * default. Also used by `@vendure/create` to scaffold every default email.
 */
export async function ejectTemplate(type: string, dir: string, force: boolean, cwd = process.cwd()) {
    const emailsDir = path.join(packageRoot(), 'src/emails');
    const sourceDir = path.join(emailsDir, type);
    if (!existsSync(path.join(sourceDir, 'template.tsx'))) {
        const entries = await fs.readdir(emailsDir, { withFileTypes: true });
        const types = entries.filter(e => e.isDirectory()).map(e => e.name);
        throw new Error(`No default email "${type}". Available: ${types.join(', ')}`);
    }
    const template = await fs.readFile(path.join(sourceDir, 'template.tsx'), 'utf-8');
    const definition = await fs.readFile(path.join(sourceDir, 'definition.ts'), 'utf-8');
    const definitionExport = /export const (\w+) = defineEmail\(/.exec(definition)?.[1];
    const templateExport = /export const (\w+) = defineEmailTemplate/.exec(template)?.[1];
    if (!definitionExport || !templateExport) {
        throw new Error(`Could not read the exports of the "${type}" email`);
    }
    // Imports of the package internals ('../../components/...') become one import of '@vendure/email'.
    const names = new Set<string>();
    const body = template.replace(
        /import\s*\{([^}]*)\}\s*from\s*'\.\.\/\.\.\/[^']+';\n?/g,
        (_m, list: string) => {
            list.split(',')
                .map(n => n.trim())
                .filter(Boolean)
                .forEach(n => names.add(n));
            return '';
        },
    );
    const header =
        `// Ejected from @vendure/email. Edit freely: this file is now owned by the project.\n` +
        `import { ${[...names].sort((a, b) => a.localeCompare(b)).join(', ')} } from '@vendure/email';\n`;
    const ejectedTemplate = header + body.replace(/^\n+/, '\n');
    const ejectedDefinition = [
        `import { defineEmail, ${definitionExport} as packageDefault } from '@vendure/email';`,
        '',
        `import { ${templateExport} } from './template';`,
        '',
        '/*',
        ' * Spreading the package default keeps its event, filter, data, recipient, sample and order page',
        ' * logic, so fixes to those still reach this project. Override any of them here.',
        ' */',
        `export const ${definitionExport} = defineEmail({`,
        '    ...packageDefault,',
        `    template: ${templateExport},`,
        '});',
        '',
    ].join('\n');
    const targetDir = path.resolve(cwd, dir, type);
    const files = [path.join(targetDir, 'template.tsx'), path.join(targetDir, 'definition.ts')];
    if (!force && files.some(f => existsSync(f))) {
        throw new Error(`${targetDir} already contains an ejected email. Use --force to overwrite it.`);
    }
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(files[0], ejectedTemplate);
    await fs.writeFile(files[1], ejectedDefinition);
    const relative = path.relative(path.resolve(cwd, 'src'), path.join(targetDir, 'definition'));
    return {
        type,
        files: files.map(f => path.relative(cwd, f)),
        definitionExport,
        importPath: `./${relative.split(path.sep).join('/')}`,
    };
}

function splitList(value: string | undefined) {
    return value
        ? value
              .split(',')
              .map(v => v.trim())
              .filter(Boolean)
        : undefined;
}

function openInBrowser(url: string) {
    let command = 'xdg-open';
    let args = [url];
    if (process.platform === 'darwin') {
        command = 'open';
    } else if (process.platform === 'win32') {
        command = 'cmd';
        args = ['/c', 'start', '""', url];
    }
    try {
        const child = spawn(command, args, { detached: true, stdio: 'ignore' });
        // No browser to open, e.g. over SSH: the URL is printed above.
        child.on('error', () => undefined);
        child.unref();
    } catch {
        // Same as above.
    }
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
    const status = entry.status === 'sent' ? 'SENT  ' : 'FAILED';
    const error = entry.error ? ' (' + String(entry.error.message) + ')' : '';
    const head = `${String(entry.sentAt)} ${status} ${String(entry.type)} to ${String(entry.recipient)}: ${String(
        entry.subject ?? '',
    )}${error} [${String(entry.id)}]`;
    return full ? `${head}\n\n${String(entry.text ?? '')}` : head;
}

interface Client {
    get(pathname: string): Promise<any>;
    post(pathname: string, body: unknown): Promise<any>;
}

async function run(options: Options, fn: (client: Client) => Promise<number>): Promise<number> {
    const baseUrl = mailboxUrl(options).concat('/api');
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
        const body = await response.json();
        // Every dev API response has a boolean `ok`. Anything else, such as the server's own 404 for a
        // wrong route, means --url doesn't point at the dev mailbox.
        if (typeof body?.ok !== 'boolean') {
            throw new UnreachableError(
                `No EmailPlugin dev API at ${baseUrl} (HTTP ${response.status}). ` +
                    'Is the EmailPlugin running in devMode, and is --url the dev mailbox route?',
            );
        }
        return body;
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
