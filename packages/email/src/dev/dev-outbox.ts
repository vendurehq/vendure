import fs from 'fs-extra';
import path from 'path';

/**
 * @description
 * A record of an email the EmailPlugin tried to send while running in dev mode, kept by the dev outbox.
 * Failed attempts are recorded too, with the error, so that a developer or agent can see why an email
 * did not arrive.
 *
 * @docsCategory core plugins/Email
 * @docsPage Dev mode tooling
 * @since 4.0.0
 */
export interface DevOutboxEntry {
    id: string;
    /**
     * @description
     * ISO timestamp of the send attempt.
     */
    sentAt: string;
    status: 'sent' | 'failed';
    /**
     * @description
     * The email type, as set on its {@link EmailDefinition}.
     */
    type: string;
    recipient?: string;
    from?: string;
    subject?: string;
    cc?: string;
    bcc?: string;
    replyTo?: string;
    html?: string;
    text?: string;
    attachments: Array<{ filename?: string }>;
    metadata?: Record<string, any>;
    languageCode?: string;
    channelCode?: string;
    templateOrigin?: string;
    error?: { message: string; stack?: string };
    /**
     * @description
     * Set when the email was sent by the dev tooling (e.g. `vendure email send`), to find its entry.
     */
    correlationId?: string;
}

export interface DevOutboxFilter {
    since?: Date;
    recipient?: string;
    type?: string;
    status?: DevOutboxEntry['status'];
    correlationId?: string;
    limit?: number;
}

/**
 * Stores dev mode outbox entries as JSON files, so that entries written by the worker process can be
 * read by the server process.
 *
 * @internal
 */
export class DevOutbox {
    constructor(private readonly dir: string) {}

    async record(entry: Omit<DevOutboxEntry, 'id' | 'sentAt'>): Promise<DevOutboxEntry> {
        const sentAt = new Date().toISOString();
        const id = `${sentAt.replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 8)}`;
        const full: DevOutboxEntry = { id, sentAt, ...entry };
        await fs.ensureDir(this.dir);
        // Write to a temporary file first, so that readers never see a partially written entry.
        const tmpPath = path.join(this.dir, `.${id}.tmp`);
        await fs.writeFile(tmpPath, JSON.stringify(full, null, 2));
        await fs.rename(tmpPath, path.join(this.dir, `${id}.json`));
        return full;
    }

    async list(filter: DevOutboxFilter = {}): Promise<DevOutboxEntry[]> {
        if (!(await fs.pathExists(this.dir))) {
            return [];
        }
        const files = (await fs.readdir(this.dir))
            .filter(name => name.endsWith('.json'))
            .sort()
            .reverse();
        const result: DevOutboxEntry[] = [];
        for (const file of files) {
            const entry = await this.read(file);
            if (!entry) {
                continue;
            }
            if (filter.since && new Date(entry.sentAt) < filter.since) {
                // Files are sorted newest first, so the rest are older too.
                break;
            }
            if (matches(entry, filter)) {
                result.push(entry);
                if (filter.limit && result.length >= filter.limit) {
                    break;
                }
            }
        }
        return result;
    }

    async get(id: string): Promise<DevOutboxEntry | undefined> {
        if (!/^[\w-]+$/.test(id)) {
            return undefined;
        }
        return this.read(`${id}.json`);
    }

    /**
     * Resolves with the matching entries as soon as there is at least one, or with an empty list once
     * `timeoutMs` has passed.
     */
    async waitFor(filter: DevOutboxFilter, timeoutMs: number, pollMs = 200): Promise<DevOutboxEntry[]> {
        const deadline = Date.now() + timeoutMs;
        while (true) {
            const entries = await this.list(filter);
            if (entries.length || Date.now() >= deadline) {
                return entries;
            }
            await new Promise(resolve => setTimeout(resolve, pollMs));
        }
    }

    private async read(file: string): Promise<DevOutboxEntry | undefined> {
        try {
            return JSON.parse(await fs.readFile(path.join(this.dir, file), 'utf-8'));
        } catch {
            return undefined;
        }
    }
}

function matches(entry: DevOutboxEntry, filter: DevOutboxFilter) {
    if (filter.type && entry.type !== filter.type) {
        return false;
    }
    if (filter.status && entry.status !== filter.status) {
        return false;
    }
    if (filter.correlationId && entry.correlationId !== filter.correlationId) {
        return false;
    }
    if (filter.recipient) {
        const wanted = filter.recipient.toLowerCase();
        const addresses = [entry.recipient, entry.cc, entry.bcc].filter(Boolean).join(',').toLowerCase();
        if (!addresses.includes(wanted)) {
            return false;
        }
    }
    return true;
}

/** @internal */
export function getDevOutboxDir(outputPath: string) {
    return path.join(outputPath, '.outbox');
}
