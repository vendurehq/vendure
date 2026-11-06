import { log } from '@clack/prompts';
import { supportsHyperlinks } from '@vendure/common/lib/supports-hyperlinks';

import { readProjectLinkManifest } from '../commands/console/project-link-manifest';

// The pricing URL shown in the hint, and the tag that names the surface that printed it.
const PRICING_URL = 'https://vendure.io/pricing';
const UTM_SOURCE = 'vendure-dev';

/**
 * The hint line. A terminal with hyperlink support shows `https://vendure.io/pricing` and links
 * to it with the `utm_source` tag. Other terminals get the plain URL without the tag.
 * `packages/create/src/console-hint.ts` holds the same text with
 * `utm_source=vendure-create`. Keep both in sync: the two packages cannot share code without a
 * new dependency.
 */
export function getConsoleHint(hyperlinks: boolean = supportsHyperlinks()): string {
    const link = hyperlinks
        ? `\u001b]8;;${PRICING_URL}?utm_source=${UTM_SOURCE}\u0007${PRICING_URL}\u001b]8;;\u0007`
        : PRICING_URL;
    return `Paid plans add 30+ features and include Vendure Cloud: ${link}. Already on a plan? Run \`vendure console link\`.`;
}

/**
 * Prints {@link getConsoleHint} unless a Project Link Manifest file exists in `projectDir`.
 * Reads one local file. It makes no network call and keeps no state.
 */
export function showConsoleHintIfUnlinked(
    projectDir: string,
    write: (message: string) => void = message => log.info(message),
): boolean {
    if (readProjectLinkManifest(projectDir).kind !== 'missing') {
        return false;
    }
    write(getConsoleHint());
    return true;
}
