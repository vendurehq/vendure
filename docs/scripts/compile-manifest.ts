import { compileManifest } from '@vendure-io/docs-provider/compiler';

const manifest = await compileManifest('docs/src/manifest.ts', {
    outputPath: 'docs/manifest.json',
});
console.log(`Compiled manifest with ${manifest.navigation.length} top-level sections`);
