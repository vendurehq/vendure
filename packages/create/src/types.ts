import type {
    CreateRecordPackageManager,
    CreateRecordPreset,
    CreateRecordScenario,
} from '@vendure/common/lib/create-record';
import type { StorefrontId } from './storefront-starters.js';

export type PackageManager = CreateRecordPackageManager;

export type CliLogLevel = 'silent' | 'info' | 'verbose';

/** The agent clients create writes files for. */
export const AGENT_CLIENTS = ['claude', 'cursor', 'vscode', 'codex'] as const;
export type AgentClient = (typeof AGENT_CLIENTS)[number];

/**
 * Every choice create makes, resolved from the flags, the prompts and the defaults, and
 * validated before anything is written.
 */
export interface CreateOptions {
    /** The absolute path of the project directory. */
    projectDir: string;
    /** The project's package name, the basename of the directory. */
    name: string;
    packageManager: PackageManager;
    storefront: StorefrontId | null;
    /** The preset that will run: the scenario's preset when a scenario is chosen. */
    preset: CreateRecordPreset | null;
    scenario: CreateRecordScenario | null;
    features: string[];
    agents: AgentClient[];
    /** Whether to run the package manager's install. */
    install: boolean;
    /** Whether to initialise a git repository and make the initial commit. */
    git: boolean;
}

/** What create did with git. */
export type GitResult =
    | { status: 'committed' }
    | { status: 'skipped'; reason: string }
    | { status: 'failed'; reason: string };

/** The one document `--json` prints on success. */
export interface CreateResult {
    projectDir: string;
    packageManager: PackageManager;
    /** The agent files written, relative to the project directory, and the clients that failed. */
    agentFiles: { written: string[]; failed: Array<{ client: string; reason: string }> };
    git: GitResult;
    /** The commands to run next, one per line. */
    next: string[];
}
