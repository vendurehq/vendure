/* eslint-disable no-console */
import chokidar from 'chokidar';
import fs from 'fs-extra';
import { globSync } from 'glob';
import path from 'path';

const SCHEMAS_GLOB = '**/*.graphql';
const MESSAGES_GLOB = 'i18n/messages/**/*';
const DEST_DIR = path.join(__dirname, '../dist');

function copyFiles(sourceGlob: string, destinationDir: string) {
    const srcDir = path.join(__dirname, '../src');
    const files = globSync(sourceGlob, {
        cwd: srcDir,
    });
    for (const file of files) {
        const destFile = path.join(destinationDir, file);
        try {
            fs.ensureDirSync(path.dirname(destFile));
            fs.copySync(path.join(srcDir, file), destFile);
        } catch (error: any) {
            console.error(`Error copying file ${file}:`, error);
        }
    }
}

function copySchemas() {
    try {
        copyFiles(SCHEMAS_GLOB, DEST_DIR);
        console.log('Schemas copied successfully!');
    } catch (error) {
        console.error('Error copying schemas:', error);
    }
}

function copyI18nMessages() {
    try {
        copyFiles(MESSAGES_GLOB, DEST_DIR);
        console.log('I18n messages copied successfully!');
    } catch (error) {
        console.error('Error copying i18n messages:', error);
    }
}

function build() {
    copySchemas();
    copyI18nMessages();
}

function watch() {
    const watcher1 = chokidar.watch(SCHEMAS_GLOB, { cwd: path.join(__dirname, '../src') });
    const watcher2 = chokidar.watch(MESSAGES_GLOB, { cwd: path.join(__dirname, '../src') });

    watcher1.on('change', copySchemas);
    watcher2.on('change', copyI18nMessages);

    console.log('Watching for changes...');
}

function runCommand() {
    const command = process.argv[2];

    if (command === 'build') {
        build();
    } else if (command === 'watch') {
        watch();
    } else {
        console.error('Invalid command. Please use "build" or "watch".');
    }
}

// Run command specified in the command line argument
runCommand();
