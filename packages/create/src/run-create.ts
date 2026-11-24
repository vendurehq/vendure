import { CREATE_RECORD_PATH } from '@vendure/common/lib/create-record';
import fs from 'fs-extra';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

import { SERVER_PORT, STOREFRONT_PORT } from './constants.js';
import { CreateError } from './errors.js';
import { getPackageManagerInfo } from './package-manager.js';
import {
    buildCreateRecord,
    getNextCommands,
    getPnpmWorkspaceYaml,
    getServerPackageJson,
    getWorkspaceRootPackageJson,
    getYarnRcYml,
    renderReadme,
    renderVendureConfig,
    SERVER_WORKSPACE_DIR,
    STOREFRONT_WORKSPACE_DIR,
    toPackageName,
} from './project-files.js';
import { findFeatureSets } from './registries.js';
import { initialiseGit, installDependencies } from './steps.js';
import {
    configureStorefrontPackageJson,
    downloadAndExtractStorefront,
    getStorefrontStarter,
    renderStorefrontEnvironment,
} from './storefront-starters.js';
import { CliLogLevel, CreateOptions, CreateResult, GitResult } from './types.js';

/** How create shows progress: clack spinners in a terminal, plain lines on stderr with --json. */
export interface Reporter {
    start(message: string): void;
    stop(message: string): void;
    /** Stops the running step, if any, as failed. Called before the error is reported. */
    fail(message: string): void;
    warn(message: string): void;
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
const ALLOWED_EXISTING_FILES = [
    '.DS_Store',
    'Thumbs.db',
    '.git',
    '.idea',
    '.vscode',
    'LICENSE',
    '.gitattributes',
];

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
        .filter(file => !ALLOWED_EXISTING_FILES.includes(file) && !file.endsWith('.iml'));
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

async function runSteps(options: CreateOptions, context: RunCreateContext): Promise<CreateResult> {
    const { reporter } = context;
    checkProjectDirectory(options.projectDir);
    const features = findFeatureSets(options.features);
    const pmInfo = getPackageManagerInfo(options.packageManager);
    const storefront = options.storefront ? getStorefrontStarter(options.storefront) : undefined;
    const root = options.projectDir;
    const serverDir = storefront ? path.join(root, SERVER_WORKSPACE_DIR) : root;
    const packageName = toPackageName(options.name);
    const template = (file: string) => fs.readFileSync(path.join(context.assetsDir, file), 'utf-8');
    const writeJson = (file: string, value: unknown) =>
        fs.outputFileSync(file, JSON.stringify(value, null, 2) + '\n');

    reporter.start(`Writing the project in ${root}`);
    if (storefront) {
        writeJson(path.join(root, 'package.json'), getWorkspaceRootPackageJson(packageName, pmInfo));
        fs.copySync(
            path.join(context.assetsDir, 'monorepo/root-gitignore.template'),
            path.join(root, '.gitignore'),
        );
    }
    writeJson(
        path.join(serverDir, 'package.json'),
        getServerPackageJson({
            name: storefront ? 'server' : packageName,
            vendureVersion: context.createVersion,
            packageManager: options.packageManager,
            features,
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
    fs.outputFileSync(
        path.join(serverDir, 'src/vendure-config.ts'),
        renderVendureConfig(template('vendure-config.hbs'), {
            mcpDevTokenSecret: randomBytes(32).toString('base64url'),
        }),
    );
    // Git keeps no empty directory. The migrations glob matches no dotfile.
    fs.outputFileSync(path.join(serverDir, 'src/migrations/.gitkeep'), '');
    fs.copySync(
        path.join(context.assetsDir, 'tsconfig.template.json'),
        path.join(serverDir, 'tsconfig.json'),
    );
    fs.copySync(path.join(context.assetsDir, 'gitignore.template'), path.join(serverDir, '.gitignore'));
    fs.outputFileSync(
        path.join(root, 'README.md'),
        renderReadme(template('readme.hbs'), { name: options.name, pmInfo, storefront }),
    );
    // Written before the install, so the choices survive a failed install. No agent files are
    // written yet, so the record names no agent client.
    writeJson(
        path.join(serverDir, CREATE_RECORD_PATH),
        buildCreateRecord(options, context.createVersion, { agents: [] }),
    );
    reporter.stop('Wrote the project files');

    if (storefront) {
        reporter.start(`Downloading the ${storefront.name} storefront`);
        const storefrontDir = path.join(root, STOREFRONT_WORKSPACE_DIR);
        try {
            await downloadAndExtractStorefront(storefrontDir, storefront);
        } catch (e) {
            throw new CreateError(
                'create.storefront-download-failed',
                `Could not download the ${storefront.name} storefront: ${e instanceof Error ? e.message : String(e)}`,
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
        reporter.stop(`Downloaded the ${storefront.name} storefront`);
    }

    if (options.install) {
        reporter.start(`Installing dependencies with ${pmInfo.name}`);
        try {
            await installDependencies(options.packageManager, root, context.logLevel);
        } catch (e) {
            if (e instanceof CreateError && options.git) {
                throw new CreateError(
                    e.code,
                    e.message,
                    [
                        e.fix,
                        `Your choices are kept in ${CREATE_RECORD_PATH}.`,
                        'Then run `git init`, `git add -A` and `git commit` to make the initial commit.',
                    ]
                        .filter(Boolean)
                        .join(' '),
                );
            }
            throw e;
        }
        reporter.stop('Installed dependencies');
    }

    let git: GitResult = { status: 'skipped', reason: '--no-git was given' };
    if (options.git) {
        reporter.start('Making the initial git commit');
        git = await initialiseGit(root);
        if (git.status === 'committed') {
            reporter.stop('Made the initial git commit');
        } else {
            reporter.stop(`No git commit: ${git.reason}`);
        }
    }

    return {
        projectDir: root,
        packageManager: options.packageManager,
        agentFiles: { written: [], failed: [] },
        git,
        next: getNextCommands(options, context.projectDirArg),
    };
}
