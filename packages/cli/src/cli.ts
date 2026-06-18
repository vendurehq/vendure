#! /usr/bin/env node

import { Command } from 'commander';
import pc from 'picocolors';

import { cliCommands } from './commands/command-declarations';
import { registerCommands } from './shared/command-registry';

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

// Register all commands from the array
registerCommands(program, cliCommands);

void program.parseAsync(process.argv);
