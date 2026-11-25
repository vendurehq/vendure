import { LinkOutput } from './console.schema.js';

/** The run already told the person what it linked and wrote, as it went. This sums it up. */
export function render(output: LinkOutput): string {
    return output.outcome === 'linked'
        ? `Linked ${output.project.name} in ${output.account.name}. Manifest: ${output.manifestPath}`
        : `Linked to ${output.project.name} in ${output.account.name}. Manifest: ${output.manifestPath}`;
}
