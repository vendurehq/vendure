/* eslint-disable no-console */
import fs from 'node:fs';
import path, { extname } from 'path';

import { generateTypescriptDocs, type DocsSectionConfig } from '@vendure-io/docs-generator';

const sections: DocsSectionConfig[] = [
    {
        sourceDirs: ['packages/job-queue-plugin/src/'],
        outputPath: '',
    },
    {
        sourceDirs: ['packages/core/src/', 'packages/common/src/', 'packages/testing/src/'],
        exclude: [/generated-shop-types/],
        outputPath: 'typescript-api',
    },
    {
        sourceDirs: ['packages/admin-ui-plugin/src/'],
        outputPath: '',
    },
    {
        sourceDirs: ['packages/asset-server-plugin/src/'],
        outputPath: '',
    },
    {
        sourceDirs: ['packages/email-plugin/src/'],
        outputPath: '',
    },
    {
        sourceDirs: ['packages/harden-plugin/src/'],
        outputPath: '',
    },
    {
        sourceDirs: ['packages/graphiql-plugin/src/'],
        outputPath: '',
    },
    {
        sourceDirs: ['packages/telemetry-plugin/src/'],
        outputPath: '',
    },
    {
        sourceDirs: ['packages/dashboard/plugin/'],
        outputPath: '',
    },
    {
        sourceDirs: ['packages/admin-ui/src/lib/', 'packages/ui-devkit/src/'],
        exclude: [/generated-types/],
        outputPath: 'admin-ui-api',
    },
    {
        sourceDirs: ['packages/dashboard/src/', 'packages/dashboard/vite/'],
        outputPath: 'dashboard',
    },
];

const repoRoot = path.join(__dirname, '../../');
const outputRoot = path.join(repoRoot, 'docs/docs/reference');
const watchMode = !!process.argv.find(arg => arg === '--watch' || arg === '-w');

generateTypescriptDocs(sections, {
    packagePrefix: '@vendure',
    repoRoot,
    outputRoot,
});


if (watchMode) {
    console.log(`Watching for changes to source files...`);
    sections.forEach(section => {
        section.sourceDirs.forEach(dir => {
            fs.watch(path.join(repoRoot, dir), { recursive: true }, (eventType, file) => {
                if (file && extname(file) === '.ts') {
                    console.log(`Changes detected in ${dir}`);
                    generateTypescriptDocs([section], {
                        packagePrefix: '@vendure',
                        repoRoot,
                        outputRoot,
                        isWatchMode: true,
                    });
                }
            });
        });
    });
}
