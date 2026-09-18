import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
    CANCEL: Symbol('clack:cancel'),
    projectDir: '',
    answers: new Map<string, unknown>(),
    // Every prompt shown, and whether a spinner was running at the time.
    prompts: [] as Array<{ message: string; spinnerRunning: boolean }>,
    runningSpinners: 0,
    events: [] as string[],
    exited: false,
    // Thrown by the process.exit stub so the run stops where a real exit would stop it.
    EXITED: new Error('process.exit'),
    swallowNextExit: false,
}));

// A running clack spinner redraws over the prompt every 80ms and installs its own Ctrl+C
// handler, which exits before checkCancel sees the cancel symbol (#5338). These fakes count
// running spinners, so a test can check that none is running when a prompt is shown.
vi.mock('@clack/prompts', async importOriginal => {
    const actual = await importOriginal<typeof import('@clack/prompts')>();
    const prompt = ({ message }: { message: string }) => {
        state.prompts.push({ message, spinnerRunning: state.runningSpinners > 0 });
        state.events.push(`prompt: ${message}`);
        if (!state.answers.has(message)) {
            throw new Error(`No answer scripted for prompt "${message}"`);
        }
        return Promise.resolve(state.answers.get(message));
    };
    return {
        ...actual,
        intro: vi.fn(),
        outro: vi.fn(),
        note: vi.fn(),
        select: vi.fn(prompt),
        text: vi.fn(prompt),
        isCancel: (value: unknown) => value === state.CANCEL,
        cancel: (message: string) => state.events.push(`cancel: ${message}`),
        spinner: () => {
            let running = false;
            return {
                start: () => {
                    if (!running) state.runningSpinners++;
                    running = true;
                },
                stop: () => {
                    if (running) state.runningSpinners--;
                    running = false;
                },
                message: vi.fn(),
            };
        },
    };
});

// create-vendure-app.ts parses argv and starts the run when it is imported. This stands in
// for commander so the import runs an interactive (non --ci) scaffold of state.projectDir.
vi.mock('commander', async importOriginal => {
    const actual = await importOriginal<typeof import('commander')>();
    const program: Record<string, unknown> = {};
    let action: (name: string) => void = () => undefined;
    for (const method of ['version', 'arguments', 'usage', 'option']) {
        program[method] = () => program;
    }
    program.action = (callback: typeof action) => {
        action = callback;
        return program;
    };
    program.parse = () => {
        action(state.projectDir);
        return program;
    };
    program.opts = () => ({ logLevel: 'silent', ci: false, db: 'sqlite' });
    program.name = () => 'create';
    return { ...actual, program };
});

// No port probing or Docker calls. 'not-running' makes Quick Start ask how to proceed.
vi.mock('./helpers', async importOriginal => {
    const actual = await importOriginal<typeof import('./helpers')>();
    return {
        ...actual,
        findAvailablePort: () => Promise.resolve(3000),
        isDockerAvailable: () => Promise.resolve({ result: 'not-running' }),
    };
});

// The CLI's last-resort handler logs an escaped error and then calls process.exit(1). When the
// error is the stand-in for an exit that already happened, that second exit is swallowed.
// Any other error is recorded, so it shows up in the event list.
vi.mock('./logger', () => ({
    setLogLevel: vi.fn(),
    log: (message: unknown) => {
        if (message === state.EXITED) {
            state.swallowNextExit = true;
        } else if (message instanceof Error) {
            state.events.push(`error: ${message.message}`);
        }
    },
}));

const MODE_PROMPT = 'How should we proceed?';
const STOREFRONT_PROMPT = 'Would you like to include a storefront?';

/**
 * Imports the CLI entry point, which runs the scaffold, and waits for the run to exit.
 * Every scripted run cancels at some prompt, so it never reaches the install step.
 */
async function runCli(answers: Record<string, unknown>) {
    state.answers = new Map(Object.entries(answers));
    await import('./create-vendure-app');
    await vi.waitFor(() => expect(state.exited).toBe(true));
    return state;
}

describe('interactive create prompts (#5352)', () => {
    let tmpDir: string;
    const originalPort = process.env.PORT;

    beforeEach(() => {
        vi.resetModules();
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vendure-create-prompts-'));
        state.projectDir = path.join(tmpDir, 'my-vendure-app');
        state.prompts = [];
        state.events = [];
        state.runningSpinners = 0;
        state.exited = false;
        state.swallowNextExit = false;
        vi.spyOn(process, 'exit').mockImplementation(code => {
            if (state.swallowNextExit) {
                state.swallowNextExit = false;
                return undefined as never;
            }
            // Only the first exit is real. Later calls come from catch blocks that the
            // thrown stand-in passes through on its way out.
            if (!state.exited) {
                state.exited = true;
                state.events.push(`exit: ${String(code)}`);
            }
            throw state.EXITED;
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        fs.removeSync(tmpDir);
        if (originalPort === undefined) {
            delete process.env.PORT;
        } else {
            process.env.PORT = originalPort;
        }
    });

    it('Quick Start shows every prompt with no spinner running, and cancels cleanly', async () => {
        const { prompts, events } = await runCli({
            [MODE_PROMPT]: 'quick',
            'We could not automatically start Docker. How should we proceed?': true,
            [STOREFRONT_PROMPT]: state.CANCEL,
        });

        expect(prompts.map(p => p.message)).toEqual([
            MODE_PROMPT,
            'We could not automatically start Docker. How should we proceed?',
            STOREFRONT_PROMPT,
        ]);
        expect(prompts.filter(p => p.spinnerRunning)).toEqual([]);
        // checkCancel handles the cancel and exits. A cancel it misses falls through to a later
        // exit with a different code, or to no exit at all.
        expect(events.slice(-3)).toEqual([
            `prompt: ${STOREFRONT_PROMPT}`,
            'cancel: Setup cancelled.',
            'exit: 0',
        ]);
    });

    it('Manual Configuration shows every prompt with no spinner running, and cancels cleanly', async () => {
        const { prompts, events } = await runCli({
            [MODE_PROMPT]: 'manual',
            // Postgres asks every connection question, including schema and SSL.
            'Which database are you using?': 'postgres',
            "What's the database host address?": 'localhost',
            'What port is the database listening on?': '5432',
            "What's the name of the database?": 'vendure',
            "What's the schema name we should use?": 'public',
            'Use SSL to connect to the database? (only enable if your database provider supports SSL)': false,
            "What's the database user name?": 'vendure',
            "What's the database password?": 'secret',
            'What identifier do you want to use for the superadmin user?': 'superadmin',
            'What password do you want to use for the superadmin user?': 'superadmin',
            'Populate with some sample product data?': true,
            [STOREFRONT_PROMPT]: state.CANCEL,
        });

        expect(prompts).toHaveLength(13);
        expect(prompts[0].message).toBe(MODE_PROMPT);
        expect(prompts.filter(p => p.spinnerRunning)).toEqual([]);
        expect(events.slice(-3)).toEqual([
            `prompt: ${STOREFRONT_PROMPT}`,
            'cancel: Setup cancelled.',
            'exit: 0',
        ]);
    });

    it('cancelling at the first prompt exits before any further work', async () => {
        const { prompts, events } = await runCli({ [MODE_PROMPT]: state.CANCEL });

        expect(prompts.map(p => p.message)).toEqual([MODE_PROMPT]);
        expect(events).toEqual([`prompt: ${MODE_PROMPT}`, 'cancel: Setup cancelled.', 'exit: 0']);
    });
});
