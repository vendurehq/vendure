import type { MergedManifestCommand } from '@vendure/common/lib/command/manifest';
import fs from 'node:fs';
import path from 'node:path';

import { resolveCommandManifests } from '../../shared/resolve-cli-plugins.js';
import { loadMergedManifest, loadProjectCommands, RefusedManifest } from '../manifest.js';

/** How often the files that decide the project's commands are checked for a change. */
const WATCH_INTERVAL_MS = 1000;

/** One listing of the project's commands, and the files it was read from. */
export interface ListedCommands {
    commands: MergedManifestCommand[];
    /** Enabled packages whose commands were left out, each with a coded error. */
    refused: RefusedManifest[];
    /** The files that decide the commands. A change to one of them means the list may change. */
    files: string[];
    /**
     * Problems with a place plugins are enabled from, such as a `cli.json` that does not parse.
     * The commands of that place are missing from this listing.
     */
    scopeErrors?: string[];
}

export interface ProjectCommandWatcherOptions {
    /** The directory the tool calls run in, whose commands are offered. */
    cwd: string;
    /** Lists the commands. Defaults to reading the manifests of the CLI and the enabled packages. */
    list?: (cwd: string) => Promise<ListedCommands>;
    /** Called when a listing fails. The commands of the previous listing are kept. */
    onListingFailed?: (reason: string) => void;
    /** Called with the packages whose commands were left out, each time the commands change. */
    onRefused?: (refused: RefusedManifest[]) => void;
    watchIntervalMs?: number;
}

/**
 * The commands of a project, for the MCP server. They come from the manifests only, so no command
 * or plugin code runs, and the listing takes milliseconds.
 *
 * While it is watched, the files that decide the commands are polled: the project's package.json,
 * the user-level plugin config, and the package.json and command manifest of each enabled
 * package. When one changes, the commands are listed again, so a package that is enabled,
 * disabled, installed or upgraded is seen without a restart.
 */
export class ProjectCommandWatcher {
    private current: ListedCommands | undefined;
    private readonly listeners = new Set<(commands: MergedManifestCommand[]) => void>();
    private watchTimer: NodeJS.Timeout | undefined;
    private relisting: Promise<void> | undefined;
    private reportedScopeErrors = '[]';

    constructor(private readonly options: ProjectCommandWatcherOptions) {}

    /**
     * Lists the commands. When the listing fails, the CLI's own commands are offered instead, and
     * {@link ProjectCommandWatcherOptions.onListingFailed} says why.
     */
    async list(): Promise<MergedManifestCommand[]> {
        try {
            this.current = await this.listNow();
            // At startup there is no earlier listing to keep, so the listing is used, and the
            // problem is reported.
            this.reportScopeErrors(this.current);
            this.options.onRefused?.(this.current.refused);
        } catch (e) {
            this.options.onListingFailed?.(e instanceof Error ? e.message : String(e));
            this.current = {
                commands: await loadMergedManifest({ plugins: [] }),
                refused: [],
                // The project's package.json, whose change is the likely fix.
                files: [path.join(this.options.cwd, 'package.json')],
            };
        }
        return this.current.commands;
    }

    /** Calls the listener with the new commands when they change. */
    onChanged(listener: (commands: MergedManifestCommand[]) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /** Starts polling the files that decide the commands. */
    watch(): void {
        if (this.watchTimer) {
            return;
        }
        // The files may have changed since the first listing read them, so the first tick always
        // lists again. That finds the same tools unless something changed.
        let signature: string | undefined;
        this.watchTimer = setInterval(() => {
            // A listing still running is not started again. The next tick compares the files anew.
            if (this.relisting) {
                return;
            }
            const next = statSignature(this.current?.files ?? []);
            if (next === signature) {
                return;
            }
            // Taken before the relisting reads the files, so a write during it is seen next tick.
            // When the relisting watches other files, their signature differs, and one more
            // relisting finds the same tools.
            signature = next;
            this.relisting = this.relist().finally(() => {
                this.relisting = undefined;
            });
        }, this.options.watchIntervalMs ?? WATCH_INTERVAL_MS);
        this.watchTimer.unref();
    }

    /** Stops watching. */
    close(): void {
        if (this.watchTimer) {
            clearInterval(this.watchTimer);
            this.watchTimer = undefined;
        }
        this.listeners.clear();
    }

    /** Lists the commands again, and tells the listeners when they changed. */
    async relist(): Promise<void> {
        let next: ListedCommands;
        try {
            next = await this.listNow();
        } catch (e) {
            this.options.onListingFailed?.(e instanceof Error ? e.message : String(e));
            return;
        }
        // A place plugins are enabled from that cannot be read, such as a cli.json being written,
        // would drop its commands. The commands of the last listing are kept instead. The watched
        // files are taken from the new listing, so the fix is seen.
        if (next.scopeErrors?.length) {
            this.reportScopeErrors(next);
            if (this.current) {
                this.current = {
                    ...this.current,
                    files: [...new Set([...this.current.files, ...next.files])],
                };
            }
            return;
        }
        this.reportedScopeErrors = '[]';
        const changed = toolsKey(next.commands) !== toolsKey(this.current?.commands ?? []);
        this.current = next;
        if (!changed) {
            return;
        }
        this.options.onRefused?.(next.refused);
        for (const listener of this.listeners) {
            listener(next.commands);
        }
    }

    /** Reports the scope errors of a listing, once while they stay the same. */
    private reportScopeErrors(listed: ListedCommands): void {
        const key = JSON.stringify(listed.scopeErrors ?? []);
        if (key === this.reportedScopeErrors) {
            return;
        }
        this.reportedScopeErrors = key;
        for (const error of listed.scopeErrors ?? []) {
            this.options.onListingFailed?.(error);
        }
    }

    private listNow(): Promise<ListedCommands> {
        return (this.options.list ?? listProjectCommands)(this.options.cwd);
    }
}

/** Reads the manifests of the CLI and of the packages that `cwd`'s project and the user enable. */
export async function listProjectCommands(cwd: string): Promise<ListedCommands> {
    const packageJsonPath = path.join(cwd, 'package.json');
    // The resolver reads a package.json that does not parse as no project at all, which would drop
    // the project's commands and stop watching it. One that an editor or an install is writing
    // fails the listing instead, so the commands of the last listing are kept.
    if (fs.existsSync(packageJsonPath)) {
        try {
            JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        } catch (e) {
            throw new Error(
                `${packageJsonPath} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
            );
        }
    }
    // Resolved once, so the files watched are those the commands were read from.
    const resolved = resolveCommandManifests({ cwd });
    const { commands, refused } = await loadProjectCommands({ resolved });
    // The project's package.json is watched even when there is none yet.
    const files = [...new Set([packageJsonPath, ...resolved.watchedFiles])];
    const scopeErrors = resolved.scopeErrors.map(({ reason }) => reason);
    return { commands, refused, files, ...(scopeErrors.length ? { scopeErrors } : {}) };
}

/** What a client sees of the commands: a change to anything else does not change the tools. */
function toolsKey(commands: MergedManifestCommand[]): string {
    return JSON.stringify(
        commands.map(({ path: commandPath, description, behavior, input, expose, keywords }) => [
            commandPath,
            description,
            behavior,
            input,
            expose,
            keywords,
        ]),
    );
}

/** The size and change time of each file, or `missing`. */
function statSignature(files: string[]): string {
    return files
        .map(file => {
            try {
                const stat = fs.statSync(file);
                return `${stat.size}:${stat.mtimeMs}`;
            } catch {
                return 'missing';
            }
        })
        .join('|');
}
