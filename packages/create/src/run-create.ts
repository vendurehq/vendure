import { CREATE_RECORD_PATH } from '@vendure/common/lib/create-record';
import fs from 'fs-extra';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

import { AgentFilesResult, mcpInstallSteps, McpInstallUnavailable, writeAgentFiles } from './agent-files.js';
import { SERVER_PORT, STOREFRONT_PORT } from './constants.js';
import { CreateError } from './errors.js';
import { getPackageManagerInfo, PackageManagerInfo } from './package-manager.js';
import {
    buildCreateRecord,
    getNextCommands,
    getPnpmWorkspaceYaml,
    getServerPackageJson,
    getWorkspaceRootPackageJson,
    getYarnRcYml,
    renderReadme,
    SERVER_WORKSPACE_DIR,
    STOREFRONT_WORKSPACE_DIR,
    toPackageName,
} from './project-files.js';
import { findFeatureSets } from './registries.js';
import { commitAll, GitInitResult, initGitRepository, installDependencies, runCommand } from './steps.js';
import {
    configureStorefrontPackageJson,
    downloadAndExtractStorefront,
    getStorefrontStarter,
    renderStorefrontEnvironment,
    StorefrontStarter,
} from './storefront-starters.js';
import { CliLogLevel, CreateOptions, CreateResult, GitResult } from './types.js';

/** How create shows progress: clack spinners in a terminal, plain lines on stderr with --json. */
export interface Reporter {
    start(message: string): void;
    stop(message: string): void;
    /** Stops the running step, if any, as failed. Called before the error is reported. */
    fail(message: string): void;
}

export interface RunCreateContext {
    /** The `@vendure/create` version, which is also the version of the Vendure packages installed. */
    createVersion: string;
    /** The directory the templates were copied to by `build.cts`. */
    assetsDir: string;
    logLevel: CliLogLevel;
    reporter: Reporter;
    /** The project directory as the user typed it, for the `cd` in `next`. */
    projectDirArg: string;
}

/**
 * Files a directory may already hold. Anything else could be overwritten, so create refuses it.
 */
const ALLOWED_EXISTING_FILES = new Set([
    '.DS_Store',
    'Thumbs.db',
    '.git',
    '.idea',
    '.vscode',
    'LICENSE',
    '.gitattributes',
]);

export function checkProjectDirectory(projectDir: string): void {
    if (!fs.existsSync(projectDir)) {
        return;
    }
    if (!fs.statSync(projectDir).isDirectory()) {
        throw new CreateError(
            'create.project-directory-not-a-directory',
            `${projectDir} exists and is not a directory.`,
            'Choose another project directory.',
        );
    }
    const conflicts = fs
        .readdirSync(projectDir)
        .filter(file => !ALLOWED_EXISTING_FILES.has(file) && !file.endsWith('.iml'));
    if (conflicts.length) {
        throw new CreateError(
            'create.project-directory-not-empty',
            `${projectDir} already contains ${conflicts.join(', ')}.`,
            'Choose a new directory, or remove those files.',
        );
    }
}

/**
 * Writes the project, installs it and makes the initial commit. No step needs a database or a
 * container runtime: the first `vendure dev` writes the initial migration and seeds the data
 * recorded in `.vendure/create.json`.
 */
export async function runCreate(options: CreateOptions, context: RunCreateContext): Promise<CreateResult> {
    try {
        return await runSteps(options, context);
    } catch (e) {
        context.reporter.fail('Create stopped');
        throw e;
    }
}

/** What every step of {@link runSteps} needs. */
interface Project {
    options: CreateOptions;
    context: RunCreateContext;
    pmInfo: PackageManagerInfo;
    storefront: StorefrontStarter | undefined;
    root: string;
    /** The Vendure project: the root, or `apps/server` with a storefront. */
    serverDir: string;
}

async function runSteps(options: CreateOptions, context: RunCreateContext): Promise<CreateResult> {
    checkProjectDirectory(options.projectDir);
    const storefront = options.storefront ? getStorefrontStarter(options.storefront) : undefined;
    const project: Project = {
        options,
        context,
        pmInfo: getPackageManagerInfo(options.packageManager),
        storefront,
        root: options.projectDir,
        serverDir: storefront ? path.join(options.projectDir, SERVER_WORKSPACE_DIR) : options.projectDir,
    };

    writeProjectFiles(project);
    if (storefront) {
        await addStorefront(project, storefront);
    }
    if (options.install) {
        await install(project);
    }
    // Before the agent files: `vendure mcp install` writes its config at the git root.
    const gitInit: GitInitResult = options.git
        ? await initGitRepository(project.root)
        : { status: 'skipped', reason: '--no-git was given' };
    // An error while writing the agent files is reported for every client, and create goes on to
    // the commit, so the project is never left with a repository and no commit.
    const agentFiles = await writeProjectAgentFiles(project).catch((e: unknown): AgentFilesResult => {
        project.context.reporter.fail('The agent files could not be written');
        const reason = `the agent files could not all be written, and some may be missing: ${e instanceof Error ? e.message : String(e)}`;
        return {
            written: [],
            failed: options.agents.map(client => ({ client, reason, retryable: false })),
        };
    });
    const git = gitInit.status === 'initialised' ? await commit(project) : gitInit;

    return {
        projectDir: project.root,
        packageManager: options.packageManager,
        agentFiles: {
            written: agentFiles.written,
            failed: agentFiles.failed.map(({ client, reason }) => ({ client, reason })),
        },
        git,
        next: withBeforeLast(
            getNextCommands(options, context.projectDirArg),
            // Only where running it again completes the config. The reason says what else to do.
            // Before `run dev`, which keeps running in the foreground.
            agentFiles.failed
                .filter(failure => failure.retryable)
                .map(({ client }) => `${project.pmInfo.exec} vendure mcp install --client ${client}`),
        ),
    };
}

/** The commands with `inserted` before the last one. */
function withBeforeLast(commands: string[], inserted: string[]): string[] {
    return [...commands.slice(0, -1), ...inserted, ...commands.slice(-1)];
}

function writeJson(file: string, value: unknown): void {
    fs.outputFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

function writeProjectFiles({ options, context, pmInfo, storefront, root, serverDir }: Project): void {
    const asset = (file: string) => path.join(context.assetsDir, file);
    const packageName = toPackageName(options.name);
    context.reporter.start(`Writing the project in ${root}`);
    if (storefront) {
        writeJson(
            path.join(root, 'package.json'),
            getWorkspaceRootPackageJson(packageName, pmInfo, context.createVersion),
        );
        fs.copySync(asset('monorepo/root-gitignore.template'), path.join(root, '.gitignore'));
    }
    writeJson(
        path.join(serverDir, 'package.json'),
        getServerPackageJson({
            name: storefront ? 'server' : packageName,
            vendureVersion: context.createVersion,
            packageManager: options.packageManager,
            features: findFeatureSets(options.features),
            scenario: options.scenario,
            isRoot: !storefront,
        }),
    );
    if (pmInfo.name === 'pnpm') {
        fs.outputFileSync(
            path.join(root, 'pnpm-workspace.yaml'),
            getPnpmWorkspaceYaml(storefront ? ['apps/*'] : undefined),
        );
    }
    if (pmInfo.name === 'yarn') {
        fs.outputFileSync(path.join(root, '.yarnrc.yml'), getYarnRcYml());
    }
    fs.copySync(asset('vendure-config.ts.template'), path.join(serverDir, 'src/vendure-config.ts'));
    // Git keeps no empty directory. The migrations glob matches no dotfile.
    fs.outputFileSync(path.join(serverDir, 'src/migrations/.gitkeep'), '');
    fs.copySync(asset('tsconfig.template.json'), path.join(serverDir, 'tsconfig.json'));
    fs.copySync(asset('gitignore.template'), path.join(serverDir, '.gitignore'));
    fs.outputFileSync(
        path.join(root, 'README.md'),
        renderReadme(fs.readFileSync(asset('readme.hbs'), 'utf-8'), {
            name: options.name,
            pmInfo,
            storefront,
        }),
    );
    // Written before the install, so the choices survive a failed install. It is written again
    // with the agent clients once their files are written.
    writeJson(
        path.join(serverDir, CREATE_RECORD_PATH),
        buildCreateRecord(options, context.createVersion, { agents: [] }),
    );
    context.reporter.stop('Wrote the project files');
}

async function addStorefront(
    { options, context, root }: Project,
    storefront: StorefrontStarter,
): Promise<void> {
    context.reporter.start(`Downloading the ${storefront.name} storefront`);
    const storefrontDir = path.join(root, STOREFRONT_WORKSPACE_DIR);
    try {
        await downloadAndExtractStorefront(storefrontDir, storefront);
    } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        throw new CreateError(
            'create.storefront-download-failed',
            `Could not download the ${storefront.name} storefront: ${reason}`,
            'Check the network connection, or set GITHUB_TOKEN if GitHub is rate-limiting you, then run create again in a new directory.',
        );
    }
    const setup = {
        projectName: options.name,
        serverPort: SERVER_PORT,
        storefrontPort: STOREFRONT_PORT,
        revalidationSecret: randomBytes(32).toString('base64'),
    };
    const storefrontPackageJson = path.join(storefrontDir, 'package.json');
    writeJson(
        storefrontPackageJson,
        configureStorefrontPackageJson(fs.readJsonSync(storefrontPackageJson), storefront, setup),
    );
    fs.outputFileSync(
        path.join(storefrontDir, storefront.envFile),
        renderStorefrontEnvironment(storefront, setup),
    );
    context.reporter.stop(`Downloaded the ${storefront.name} storefront`);
}

async function install(project: Project): Promise<void> {
    const { options, context, pmInfo, root, serverDir } = project;
    context.reporter.start(`Installing dependencies with ${pmInfo.name}`);
    try {
        await installDependencies(options.packageManager, root, context.logLevel);
    } catch (e) {
        if (!(e instanceof CreateError)) {
            throw e;
        }
        context.reporter.fail('The install failed');
        // None of the agent files needs the install except the `vendure` MCP entry, so they are
        // written before create stops. The same checks as a finished run apply. With git, the
        // user runs `git init` next, so only a project inside another repository is blocked.
        const checked = await whyMcpInstallCannotRun(options, root);
        const insideAnotherRepository = checked?.kind === 'inside-another-repository';
        const blocked = options.git && !insideAnotherRepository ? undefined : checked;
        // A failure here must not hide the install's own error, which is the one to fix first.
        let agentFilesError: string | undefined;
        try {
            await writeProjectAgentFiles(project, blocked ?? NOT_INSTALLED);
        } catch (agentError) {
            agentFilesError = agentError instanceof Error ? agentError.message : String(agentError);
        }
        const recordPath = path.relative(root, path.join(serverDir, CREATE_RECORD_PATH));
        const fix = [
            e.fix,
            agentFilesError
                ? `Your choices are kept in ${recordPath.split(path.sep).join('/')}. The agent files could not be written: ${agentFilesError}.`
                : `Your choices are kept in ${recordPath.split(path.sep).join('/')}${options.agents.length ? ', and the agent files are written' : ''}.`,
        ];
        const mcpInstall = mcpInstallSteps(options.agents, pmInfo.exec);
        if (options.git && !insideAnotherRepository) {
            // `vendure mcp install` writes at the git root, so the repository comes first.
            fix.push(
                options.agents.length
                    ? `After the install, run \`git init\`, then ${mcpInstall}, then \`git add -A\` and \`git commit\`.`
                    : 'After the install, run `git init`, `git add -A` and `git commit` to make the initial commit.',
            );
        } else if (options.agents.length) {
            fix.push(
                blocked
                    ? `The agent configs need more: ${blocked.reason}.`
                    : `After the install, run ${mcpInstall}.`,
            );
        }
        throw new CreateError(e.code, e.message, fix.filter(Boolean).join(' '));
    }
    context.reporter.stop('Installed dependencies');
}

const NOT_INSTALLED: McpInstallUnavailable = {
    kind: 'not-installed',
    reason: 'the dependencies were not installed, so `vendure mcp install` could not run',
    retryable: true,
};

async function writeProjectAgentFiles(
    project: Project,
    unavailable?: McpInstallUnavailable,
): Promise<AgentFilesResult> {
    const { options, context, root, serverDir } = project;
    if (!options.agents.length) {
        // The record written with the project files already names no client.
        return { written: [], failed: [] };
    }
    context.reporter.start('Writing the agent files');
    const agentFiles = await writeAgentFiles({
        agents: options.agents,
        name: options.name,
        pmInfo: project.pmInfo,
        storefront: project.storefront,
        root,
        serverDir,
        assetsDir: context.assetsDir,
        mcpInstallUnavailable: unavailable ?? (await whyMcpInstallCannotRun(options, root)),
    });
    const failures = agentFiles.failed.map(failure => failure.client + ' (' + failure.reason + ')');
    context.reporter.stop(
        failures.length ? 'Wrote the agent files, except: ' + failures.join('; ') : 'Wrote the agent files',
    );
    // Rewritten with the clients create wrote files for, as the record's contract says. A client
    // whose MCP config is incomplete is still one, and `agentFiles.failed` says what is missing.
    writeJson(
        path.join(serverDir, CREATE_RECORD_PATH),
        buildCreateRecord(options, context.createVersion, { agents: options.agents }),
    );
    return agentFiles;
}

async function commit({ context, root }: Project): Promise<GitResult> {
    context.reporter.start('Making the initial git commit');
    const git = await commitAll(root);
    context.reporter.stop(
        git.status === 'committed' ? 'Made the initial git commit' : 'No git commit: ' + git.reason,
    );
    return git;
}

function gitNotInstalledInWorkspace(options: CreateOptions): string {
    const exec = getPackageManagerInfo(options.packageManager).exec;
    return [
        'git is not installed, so the project has no repository, and `vendure mcp install` would write',
        `into apps/server. Install git, then run \`git init\` and in the project root ${mcpInstallSteps(options.agents, exec)}`,
    ].join(' ');
}

const INSIDE_ANOTHER_REPOSITORY = [
    'the project is inside another git repository, and `vendure mcp install` writes at that',
    "repository's root. Add the `vendure` server to the config by hand",
].join(' ');

function noRepositoryInWorkspace(options: CreateOptions): string {
    const exec = getPackageManagerInfo(options.packageManager).exec;
    return [
        'the project has no git repository, so `vendure mcp install` would write into apps/server.',
        `Run \`git init\`, then in the project root ${mcpInstallSteps(options.agents, exec)}`,
    ].join(' ');
}

/**
 * `vendure mcp install` writes at the git root, which must be the project root, and runs the
 * project's own CLI. Returns why it cannot run, or `undefined`.
 */
async function whyMcpInstallCannotRun(
    options: CreateOptions,
    root: string,
): Promise<McpInstallUnavailable | undefined> {
    const top = await runCommand('git', ['rev-parse', '--show-toplevel'], { cwd: root });
    if (top.code === 0 && fs.realpathSync(top.stdout.trim()) !== fs.realpathSync(root)) {
        return {
            kind: 'inside-another-repository',
            reason: INSIDE_ANOTHER_REPOSITORY,
            retryable: false,
        };
    }
    if (top.code !== 0 && options.storefront) {
        return {
            kind: 'no-repository-in-workspace',
            // Without git there is no `git init` to suggest, only where the configs would go.
            reason: top.spawnError ? gitNotInstalledInWorkspace(options) : noRepositoryInWorkspace(options),
            retryable: false,
        };
    }
    if (!options.install) {
        return NOT_INSTALLED;
    }
    return undefined;
}
