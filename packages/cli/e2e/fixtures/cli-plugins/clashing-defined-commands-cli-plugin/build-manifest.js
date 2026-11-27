// Rebuild with: node build-manifest.js
import { writeCommandManifest } from '@vendure/common/lib/command/manifest';
import fs from 'node:fs';

import { commands } from './commands.js';

const { name, version } = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));
await writeCommandManifest(import.meta.dirname, name, version, commands);
