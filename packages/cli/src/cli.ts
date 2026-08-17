#! /usr/bin/env node

import { Command } from 'commander';
import pc from 'picocolors';

import { builtinCommandDefs } from './commands/builtins';
import { CommandRegistry } from './shared/command-registry-store';
import { registerCommands } from './shared/command-registry';
import {
    findInactivePluginProvidingCommand,
    listInactiveCliPluginPackages,
    resolveCliPlugins,
} from './shared/resolve-cli-plugins';

async function main(): Promise<void> {
    const program = new Command();

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const version = require('../package.json').version;

    program
        .version(version)
        .usage(`vendure <command>`)
        .description(
            pc.blue(`
                                888                          
                                888                          
                                888                          
888  888  .d88b.  88888b.   .d88888 888  888 888d888 .d88b.  
888  888 d8P  Y8b 888 "88b d88" 888 888  888 888P"  d8P  Y8b 
Y88  88P 88888888 888  888 888  888 888  888 888    88888888 
 Y8bd8P  Y8b.     888  888 Y88b 888 Y88b 888 888    Y8b.     
  Y88P    "Y8888  888  888  "Y88888  "Y88888 888     "Y8888                             
`),
        );

    const registry = new CommandRegistry();
    registry.registerAll(builtinCommandDefs);

    // A broken plugin must not take down the CLI: built-ins (including the
    // `plugins` command needed to disable it) stay available.
    const { loaded, failures } = resolveCliPlugins();
    for (const failure of failures) {
        process.stderr.write(pc.red(`Failed to load CLI plugin "${failure.packageName}": ${failure.reason}\n`));
        process.stderr.write(
            `Skipping it. Fix the issue or disable it with: vendure plugins remove ${failure.packageName}\n`,
        );
    }
    for (const { plugin } of loaded) {
        registry.applyPlugin(plugin);
    }

    registerCommands(program, registry.toArray());

    program.on('command:*', operands => {
        const unknown = operands[0] ?? '';
        writeUnknownCommandHelp(unknown);
        process.exit(1);
    });

    maybeWriteInactivePluginsHint(process.argv);

    await program.parseAsync(process.argv);
}

/**
 * One-line hint when packages declare CLI plugins but are not enabled yet.
 * Skipped for `vendure plugins` itself and for `--help` / `--version`.
 */
function maybeWriteInactivePluginsHint(argv: string[]): void {
    const args = argv.slice(2);
    if (args.length === 0) {
        return;
    }
    const primary = args.find(arg => !arg.startsWith('-'));
    if (
        primary === 'plugins' ||
        primary === 'help' ||
        args.includes('--help') ||
        args.includes('-h') ||
        args.includes('--version') ||
        args.includes('-V')
    ) {
        return;
    }

    const inactive = listInactiveCliPluginPackages();
    if (inactive.length === 0) {
        return;
    }

    const noun = inactive.length === 1 ? 'package provides' : 'packages provide';
    process.stderr.write(
        `${inactive.length} ${noun} CLI commands. Run "vendure plugins" to review them.\n`,
    );
}

function writeUnknownCommandHelp(commandName: string): void {
    process.stderr.write(`Unknown command "${commandName}".\n`);

    const provider = findInactivePluginProvidingCommand(commandName);
    if (provider) {
        process.stderr.write(
            `It is provided by ${provider.packageName}, which is installed but not enabled.\n`,
        );
        process.stderr.write(`Enable it with: vendure plugins add ${provider.packageName}\n`);
        return;
    }

    const inactive = listInactiveCliPluginPackages();
    if (inactive.length === 1) {
        process.stderr.write(
            `It may be provided by ${inactive[0]}, which is installed but not enabled.\n`,
        );
        process.stderr.write(`Enable it with: vendure plugins add ${inactive[0]}\n`);
        return;
    }
    if (inactive.length > 1) {
        process.stderr.write(
            `${inactive.length} packages provide CLI commands but are not enabled. Run "vendure plugins" to review them.\n`,
        );
    }
}

void main().catch((e: any) => {
    process.stderr.write(`${e?.message ?? String(e)}\n`);
    process.exit(1);
});
