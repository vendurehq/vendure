import { defineCommand } from '@vendure/common/lib/command';

// No `requires.project`: reporting that a directory is not a Vendure project is one of doctor's
// own checks, so refusing to run would remove that answer.
export const doctorCommand = defineCommand({
    path: ['doctor'],
    description: 'Run diagnostic checks on your Vendure project',
    keywords: ['diagnose', 'health', 'check', 'troubleshoot'],
    behavior: 'readonly',
    schemas: () => import('./doctor.schema.js'),
    examples: ['vendure doctor', 'vendure doctor --check config --check database --strict'],
    run: () => import('./doctor.run.js'),
    render: () => import('./doctor.render.js'),
});
