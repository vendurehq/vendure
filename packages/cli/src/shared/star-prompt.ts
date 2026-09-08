import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import pc from 'picocolors';

const horizontalPadding = 5;
const verticalPadding = 5;

export interface ShowStarPromptOptions {
    configDir?: string;
    isInteractive?: boolean;
    color?: boolean;
    write?: (output: string) => void;
}

/**
 * Shows a one-time prompt asking developers to star Vendure on GitHub.
 *
 * The marker file is created before writing the prompt so concurrent CLI
 * processes cannot each display it.
 */
export function showStarPromptOnce(options: ShowStarPromptOptions = {}): boolean {
    const isInteractive = options.isInteractive ?? process.stdout.isTTY === true;
    if (!isInteractive) {
        return false;
    }

    const configDir = options.configDir ?? getVendureCliConfigDir();
    try {
        mkdirSync(configDir, { recursive: true });
        writeFileSync(path.join(configDir, 'star-prompted'), '', { flag: 'wx' });
    } catch (error: unknown) {
        if (isAlreadyPromptedError(error)) {
            return false;
        }
        // A promotional prompt should never prevent the CLI from shutting down.
        return false;
    }

    const output = renderStarPrompt(options.color ?? pc.isColorSupported);
    (options.write ?? (message => process.stdout.write(message)))(output);
    return true;
}

export function getVendureCliConfigDir(env: NodeJS.ProcessEnv = process.env): string {
    if (env.VENDURE_CLI_CONFIG_DIR) {
        return env.VENDURE_CLI_CONFIG_DIR;
    }
    if (env.XDG_CONFIG_HOME) {
        return path.join(env.XDG_CONFIG_HOME, 'vendure');
    }
    if (process.platform === 'win32' && env.APPDATA) {
        return path.join(env.APPDATA, 'vendure');
    }
    return path.join(homedir(), '.config', 'vendure');
}

export function renderStarPrompt(color = pc.isColorSupported): string {
    const lines = [
        '✨ Thanks for using Vendure.',
        '',
        'If you like the experience, please consider starring us on GitHub',
        'https://github.com/vendurehq/vendure',
        '',
        'Note: you will not see this message again.',
    ];
    const contentWidth = Math.max(...lines.map(line => line.length));
    const innerWidth = contentWidth + horizontalPadding * 2;
    const blue = color ? pc.blue : (value: string) => value;
    const emptyLine = `${blue('║')}${' '.repeat(innerWidth)}${blue('║')}`;
    const body = lines.map(
        line =>
            `${blue('║')}${' '.repeat(horizontalPadding)}${line.padEnd(contentWidth)}${' '.repeat(horizontalPadding)}${blue('║')}`,
    );

    return [
        '',
        blue(`╔${'═'.repeat(innerWidth)}╗`),
        ...Array.from({ length: verticalPadding }, () => emptyLine),
        ...body,
        ...Array.from({ length: verticalPadding }, () => emptyLine),
        blue(`╚${'═'.repeat(innerWidth)}╝`),
        '',
    ].join('\n');
}

function isAlreadyPromptedError(error: unknown): boolean {
    return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}
