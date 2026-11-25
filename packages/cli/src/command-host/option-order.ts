import { Command } from 'commander';

/**
 * The command line with every option moved after the full command path, when the arguments name a
 * command of the program, such as `vendure cloud deploy plan --environment prod` for
 * `vendure cloud deploy --environment prod plan`. Undefined when they don't name one.
 */
export function commandLineWithOptionsLast(program: Command, args: readonly string[]): string | undefined {
    const path: string[] = [];
    const rest: string[] = [];
    let command = program;
    for (const arg of args) {
        const child = arg.startsWith('-')
            ? undefined
            : command.commands.find(candidate => candidate.name() === arg);
        if (child) {
            path.push(arg);
            command = child;
        } else {
            rest.push(arg);
        }
    }
    if (path.length === 0) {
        return undefined;
    }
    return ['vendure', ...path, ...rest.map(quoteForShell)].join(' ');
}

/** An argument as a POSIX shell reads it back: quoted when it holds a space or a special character. */
function quoteForShell(arg: string): string {
    return /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
}
