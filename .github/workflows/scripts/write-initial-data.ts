/**
 * Writes the initial data of the repository's e2e tests as JSON, for the self-hosted test app of
 * the "publish & install" workflow. Run it with bun, which runs the TypeScript source directly.
 *
 *   bun write-initial-data.ts <output file>
 */
import { initialData } from '../../../packages/core/mock-data/data-sources/initial-data';

await Bun.write(process.argv[2], JSON.stringify(initialData, null, 2));
