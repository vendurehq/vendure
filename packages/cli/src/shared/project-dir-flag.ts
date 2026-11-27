/**
 * The flag that selects the project directory of the commands that load the CLI plugins of that
 * project rather than of the working directory: `vendure dev` and the `vendure console` commands.
 * The CLI reads it from the command line before plugins load, so it decides whose plugins load.
 */
export const PROJECT_DIR_FLAG = '--dir';

/** The first segment of each command whose `dir` input selects the project its plugins load from. */
const PROJECT_DIR_COMMANDS = new Set(['dev', 'console']);

/** Whether the command at `commandPath` takes its plugins from the project its `dir` names. */
export function selectsPluginProject(commandPath: string[]): boolean {
    return PROJECT_DIR_COMMANDS.has(commandPath[0] ?? '');
}

/**
 * The command-line arguments that pass a `dir` given as input to a command that
 * {@link selectsPluginProject}, so a process started with the input on stdin, such as a Developer
 * MCP tool call, loads the plugins of the same project. Empty for any other command.
 */
export function projectDirArgs(commandPath: string[], input: Record<string, unknown>): string[] {
    return selectsPluginProject(commandPath) && typeof input.dir === 'string' && input.dir.trim()
        ? [PROJECT_DIR_FLAG, input.dir]
        : [];
}
