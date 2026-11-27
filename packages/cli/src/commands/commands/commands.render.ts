export function render(output: {
    commands: Array<{ path: string[]; description?: string; behavior?: string }>;
}): string {
    return output.commands
        .map(
            command =>
                `${command.path.join(' ').padEnd(24)}${command.behavior?.padEnd(12) ?? ''}${command.description ?? ''}`,
        )
        .join('\n');
}
