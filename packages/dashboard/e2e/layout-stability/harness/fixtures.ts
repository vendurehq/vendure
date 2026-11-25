import { test as base } from '@playwright/test';

import { LIST_PAGE_ANCHORS } from './anchors.js';
import { HeldNetwork } from './network.js';
import { layoutSeed } from './orders.js';
import { installRecorder, type AnchorSpec } from './recorder.js';
import type { LayoutContext } from './scenario.js';

export const VIEWPORTS = [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'mobile', width: 390, height: 844 },
] as const;

const seed = layoutSeed();

export const test = base.extend<{ anchors: AnchorSpec[]; layout: LayoutContext }>({
    anchors: [LIST_PAGE_ANCHORS, { option: true }],
    layout: async ({ page, anchors }, use, testInfo) => {
        await page.addInitScript(installRecorder, anchors);
        const network = new HeldNetwork(page);
        await network.install();
        testInfo.annotations.push({ type: 'LAYOUT_SEED', description: String(seed) });
        await use({ page, network, testInfo, seed });
    },
});

export { expect } from '@playwright/test';
