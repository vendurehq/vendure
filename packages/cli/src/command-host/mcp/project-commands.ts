import type { MergedManifestCommand } from '@vendure/common/lib/command/manifest';
import fs from 'node:fs';
import path from 'node:path';

import { getGlobalCliConfigPath } from '../../shared/cli-global-plugin-config.js';
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

    constructor(private readonly options: ProjectCommandWatcherOptions) {}

    /**
     * Lists the commands. When the listing fails, the CLI's own commands are offered instead, and
     * {@link ProjectCommandWatcherOptions.onListingFailed} says why.
     */
    async list(): Promise<MergedManifestCommand[]> {
        try {
            this.current = await this.listNow();
            this.options.onRefused?.(this.current.refused);
        } catch (e) {
            this.options.onListingFailed?.(e instanceof Error ? e.message : String(e));
            this.current = {
                commands: await loadMergedManifest({ plugins: [] }),
                refused: [],
                files: defaultWatchedFiles(this.options.cwd, []),
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
        let signature = statSignature(this.current?.files ?? []);
        this.watchTimer = setInterval(() => {
            // A listing still running is not started again. The next tick compares the files anew.
            if (this.relisting) {
                return;
            }
            const next = statSignature(this.current?.files ?? []);
            if (next === signature) {
                return;
            }
            this.relisting = this.relist().finally(() => {
                signature = statSignature(this.current?.files ?? []);
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

    private listNow(): Promise<ListedCommands> {
        return (this.options.list ?? listProjectCommands)(this.options.cwd);
    }
}

/** Reads the manifests of the CLI and of the packages that `cwd`'s project and the user enable. */
export async function listProjectCommands(cwd: string): Promise<ListedCommands> {
    // Resolved once, so the files watched are those the commands were read from.
    const resolved = resolveCommandManifests({ cwd });
    const { commands, refused } = await loadProjectCommands({ resolved });
    const packages = [
        ...resolved.manifests.map(({ packageName, definitionsPath }) => ({
            packageName,
            from: definitionsPath,
        })),
        ...resolved.failures.map(({ packageName }) => ({ packageName, from: undefined })),
    ];
    return {
        commands,
        refused,
        files: [
            ...defaultWatchedFiles(cwd, []),
            ...packages.flatMap(({ packageName, from }) => packageFiles(cwd, packageName, from)),
        ],
    };
}

function defaultWatchedFiles(cwd: string, extra: string[]): string[] {
    return [path.join(cwd, 'package.json'), getGlobalCliConfigPath(), ...extra];
}

/**
 * The files of an enabled package that decide its commands: its package.json and the command
 * manifest it names. A package that resolved is found above its definitions. One that did not,
 * for example because it is not installed yet, is looked for in each `node_modules` above the
 * project, so an install is noticed.
 */
function packageFiles(cwd: string, packageName: string, definitionsPath: string | undefined): string[] {
    const packageJsonPaths = definitionsPath
        ? [findPackageJson(path.dirname(definitionsPath), packageName)].filter(
              (file): file is string => file !== undefined,
          )
        : ancestors(cwd).map(dir => path.join(dir, 'node_modules', packageName, 'package.json'));
    return packageJsonPaths.flatMap(packageJsonPath => {
        const manifest = declaredManifestPath(packageJsonPath);
        return manifest ? [packageJsonPath, manifest] : [packageJsonPath];
    });
}

/** The package.json of the package named `packageName`, at or above `dir`. */
function findPackageJson(dir: string, packageName: string): string | undefined {
    for (const candidate of ancestors(dir)) {
        const file = path.join(candidate, 'package.json');
        try {
            if ((JSON.parse(fs.readFileSync(file, 'utf-8')) as { name?: unknown }).name === packageName) {
                return file;
            }
        } catch {
            // No package.json here, or not one that can be read.
        }
    }
    return undefined;
}

/** The command manifest a package.json names, if it can be read and names one. */
function declaredManifestPath(packageJsonPath: string): string | undefined {
    try {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as {
            vendure?: { commandManifest?: unknown };
        };
        const manifest = packageJson.vendure?.commandManifest;
        return typeof manifest === 'string'
            ? path.resolve(path.dirname(packageJsonPath), manifest)
            : undefined;
    } catch {
        return undefined;
    }
}

/** `dir` and each directory above it. */
function ancestors(dir: string): string[] {
    const dirs = [path.resolve(dir)];
    for (
        let parent = path.dirname(dirs[0]);
        parent !== dirs[dirs.length - 1];
        parent = path.dirname(parent)
    ) {
        dirs.push(parent);
    }
    return dirs;
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
