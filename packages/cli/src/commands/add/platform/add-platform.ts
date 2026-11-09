import { cancel, confirm, isCancel, log } from '@clack/prompts';
import spawn from 'cross-spawn';
import pc from 'picocolors';

import { exitCliCommand } from '../../../shared/cli-command-exit';
import { abortIfNonInteractive } from '../../../utilities/utils';
import { openConsoleBrowser } from '../../console/authentication';
import {
    consoleOriginsForManifest,
    readProjectLinkManifest,
    resolveProjectRoot,
} from '../../console/project-link-manifest';

/**
 * The Platform package that installs the plan packages for a linked Project. It is public, so it
 * runs under npx before the project has a registry token. `@vendure-platform/cli` and its
 * `edition` command are restricted and refuse a trial Project, so they cannot do this step.
 */
const PLATFORM_ADD_ARGS = ['--yes', '@vendure-platform/create@latest', 'add'];
const RETRY_HINT = 'Run "vendure add" again to continue.';

export interface PlatformTrialDependencies {
    cwd: string;
    /** Runs a command attached to the terminal and resolves to its exit code. */
    run: (
        command: string,
        args: string[],
        options: { cwd: string; env: NodeJS.ProcessEnv },
    ) => Promise<number>;
    openUrl: (url: string) => Promise<void>;
    confirmTrialStarted: (message: string) => Promise<boolean | symbol>;
}

const defaultDependencies: PlatformTrialDependencies = {
    cwd: process.cwd(),
    run: runAttached,
    openUrl: openConsoleBrowser,
    confirmTrialStarted: message => confirm({ message, initialValue: true }),
};

/**
 * Links the project to a Vendure Console Project, opens the trial page of that Project, and hands
 * over to Platform to install the plan packages. Core holds no plan or trial logic: Console starts
 * the trial and Platform does the install. Nothing reaches the network before the user selects
 * this flow, and a cancel at any step leaves a working OSS project.
 */
export async function addPlatform(dependencies: Partial<PlatformTrialDependencies> = {}) {
    const deps = { ...defaultDependencies, ...dependencies };
    abortIfNonInteractive('vendure add --platform', []);

    // 1. Link. `vendure console link` is the one implementation of linking, so it runs as its own
    // command, with the CLI plugins of the project loaded.
    log.step('Step 1 of 3: Link this project to a Vendure Console Project');
    stopUnlessSucceeded(
        await deps.run(process.execPath, [process.argv[1], 'console', 'link'], {
            cwd: deps.cwd,
            env: process.env,
        }),
        `Your project is unchanged. ${RETRY_HINT}`,
    );

    // The hand-over reads the linked Project from this manifest, so it must be valid first.
    const projectRoot = resolveProjectRoot(deps.cwd);
    const manifest = readProjectLinkManifest(projectRoot);
    if (manifest.kind !== 'valid') {
        // `vendure console link` exits with 0 when the user keeps an invalid manifest.
        const reason = manifest.kind === 'invalid' ? ` ${manifest.reason}` : '';
        cancel(
            `Platform setup stopped. The Project Link Manifest at ${manifest.path} is not valid.${reason} ` +
                `Run "vendure console link --force" to replace it, then run "vendure add" again.`,
        );
        exitCliCommand(0);
    }
    const { project } = manifest.manifest;
    const origins = consoleOriginsForManifest(manifest.manifest);

    // 2. Trial. Console starts the card-less trial on the subscription page of the Project.
    log.step('Step 2 of 3: Start the free 30-day trial in Vendure Console');
    const trialUrl = `${origins.appOrigin}/projects/${encodeURIComponent(project.id)}/subscription`;
    log.info(`Opening ${pc.cyan(trialUrl)}`);
    await deps.openUrl(trialUrl).catch(() => log.warn('Could not open a browser. Open the URL above.'));
    const started = await deps.confirmTrialStarted(`Did you start the trial for ${project.name}?`);
    if (isCancel(started) || !started) {
        cancel(
            `Platform setup stopped. The project is linked to ${project.name}, nothing else changed. ${RETRY_HINT}`,
        );
        exitCliCommand(0);
    }

    // 3. Hand over to Platform. The Console origins of the link go with it, so a project linked
    // to staging installs from staging.
    log.step('Step 3 of 3: Install the Vendure Platform packages');
    const env = {
        ...process.env,
        VENDURE_CONSOLE_APP_URL: origins.appOrigin,
        VENDURE_CONSOLE_API_URL: origins.apiOrigin,
    };
    stopUnlessSucceeded(
        await deps.run('npx', PLATFORM_ADD_ARGS, { cwd: projectRoot, env }),
        `To finish, run "npx ${PLATFORM_ADD_ARGS.join(' ')}" in ${projectRoot}.`,
    );
    log.success(`Vendure Platform is set up for ${project.name}.`);
    return { project: undefined, modifiedSourceFiles: [] };
}

/**
 * Exit code 130 is a cancel (Ctrl+C), which ends the flow with success. Any other failure ends
 * it with exit code 1.
 */
function stopUnlessSucceeded(code: number, detail: string) {
    if (code === 0) {
        return;
    }
    if (code === 130) {
        cancel(`Platform setup cancelled. ${detail}`);
        exitCliCommand(0);
    }
    log.error(`Platform setup stopped. ${detail}`);
    exitCliCommand(1);
}

/**
 * Ctrl+C reaches the child and this process together. This process ignores it while the child
 * runs, so the child decides how to stop and this flow reports the result.
 */
function runAttached(
    command: string,
    args: string[],
    options: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<number> {
    const ignore = () => undefined;
    process.on('SIGINT', ignore);
    return new Promise<number>(resolve => {
        const child = spawn(command, args, { ...options, stdio: 'inherit' });
        child.once('error', () => resolve(1));
        child.once('close', (code, signal) => resolve(signal === 'SIGINT' ? 130 : (code ?? 1)));
    }).finally(() => process.removeListener('SIGINT', ignore));
}
