#! /usr/bin/env node

import { Command } from 'commander';
import pc from 'picocolors';

import { builtinCommandDefs } from './commands/builtins';
import { registerCommands } from './shared/command-registry';
import { CommandRegistry, RESERVED_FLAGS } from './shared/command-registry-store';
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
        // Commander otherwise names the program after the binary file
        // (`cli.js`), which would make every subcommand's help say `cli ...`.
        .name('vendure')
        .version(version)
        .usage(`<command>`)
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
        writePluginSkipped(failure.packageName, 'Failed to load CLI plugin', failure.reason);
    }
    for (const { packageName, plugin } of loaded) {
        try {
            registry.applyPlugin(plugin);
        } catch (e) {
            const reason = e instanceof Error ? e.message : String(e);
            writePluginSkipped(packageName, 'Failed to register CLI plugin', reason);
        }
    }

    registerCommands(program, registry.toArray(), registry.getRootOptions());

    program.on('command:*', operands => {
        const unknown = operands[0] ?? '';
        writeUnknownCommandHelp(unknown);
        process.exit(1);
    });

    maybeWriteInactivePluginsHint(process.argv);

    await program.parseAsync(process.argv);
}

/**
 * Reports a plugin the CLI could not use, and how to disable it. Built-ins stay
 * registered either way, so `vendure plugins remove` remains reachable.
 */
function writePluginSkipped(packageName: string, headline: string, reason: string): void {
    process.stderr.write(pc.red(`${headline} "${packageName}": ${reason}\n`));
    process.stderr.write(
        `Skipping it. Fix the issue or disable it with: vendure plugins remove ${packageName}\n`,
    );
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
    if (primary === 'plugins' || primary === 'help' || args.some(arg => RESERVED_FLAGS.includes(arg))) {
        return;
    }

    const inactive = listInactiveCliPluginPackages();
    if (inactive.length === 0) {
        return;
    }

    const noun = inactive.length === 1 ? 'package provides' : 'packages provide';
    process.stderr.write(`${inactive.length} ${noun} CLI commands. Run "vendure plugins" to review them.\n`);
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
        process.stderr.write(`It may be provided by ${inactive[0]}, which is installed but not enabled.\n`);
        process.stderr.write(`Enable it with: vendure plugins add ${inactive[0]}\n`);
        return;
    }
    if (inactive.length > 1) {
        process.stderr.write(
            `${inactive.length} packages provide CLI commands but are not enabled. Run "vendure plugins" to review them.\n`,
        );
    }
}

void main().catch((e: unknown) => {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
});
