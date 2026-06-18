import { manifest } from '../src/manifest.js';
import { runAllTests } from '@vendure-io/docs-provider/testing';

async function main() {
    const verbose = process.argv.includes('--verbose');

    await runAllTests(manifest, {
        verbose,
    });
}

main().catch((error) => {
    console.error('Test runner error:', error);
    process.exit(1);
});
