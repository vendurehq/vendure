/* eslint-disable no-console */
import {
    bootstrapWorker,
    ChannelService,
    FacetService,
    FacetValueService,
    LanguageCode,
    RequestContextService,
} from '@vendure/core';

import { devConfig } from '../dev-config';

const FACET_VALUE_COUNT = 1500;

generateManyFacetValues()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));

// Used for testing scenarios where there are many channels
// such as https://github.com/vendurehq/vendure/issues/2233
async function generateManyFacetValues() {
    const { app } = await bootstrapWorker(devConfig);
    const requestContextService = app.get(RequestContextService);
    const channelService = app.get(ChannelService);
    const facetService = app.get(FacetService);
    const facetValueService = app.get(FacetValueService);

    const ctxAdmin = await requestContextService.create({
        apiType: 'admin',
    });
    const facet = await facetService.create(ctxAdmin, {
        code: 'color',
        translations: [{ languageCode: LanguageCode.en, name: 'Color' }],
        isPrivate: false,
        values: [],
    });
    for (let i = FACET_VALUE_COUNT; i > 0; i--) {
        const facetValue = await facetValueService.create(ctxAdmin, facet, {
            code: `color-${i}`,
            translations: [{ languageCode: LanguageCode.en, name: `Color ${i}` }],
            facetId: facet.id,
        });
        console.log(`Created channel ${facetValue.code}`);
    }
}
