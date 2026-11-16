import { describe, expectTypeOf, it } from 'vitest';

import { RequestContext } from '../../api/common/request-context';
import { Asset } from '../asset/asset.entity';
import { CustomFacetFields, CustomStockLocationFields } from '../custom-entity-fields';
import { Facet } from '../facet/facet.entity';
import { StockLocation } from '../stock-location/stock-location.entity';

import { FacetChannel } from './channel-assignment.entities';

// Augmentations apply to the whole type-check program, so a type which no other code constructs is
// augmented, with optional fields.
declare module '../custom-entity-fields' {
    interface CustomFacetFields {
        channelNote?: string | null;
        channelFeaturedAsset?: Asset | null;
    }
}

declare const ctx: RequestContext;
declare const facet: Facet;
declare const stockLocation: StockLocation;

// #490: channel-scoped custom fields are declared and read like other custom fields: entities loaded
// with a RequestContext have the values of its Channel on `customFields`.
describe('channel-scoped custom fields of Facet (#490)', () => {
    it('are part of customFields, like other custom fields', () => {
        expectTypeOf(facet.customFields.channelNote).toEqualTypeOf<string | null | undefined>();
    });

    it('are read for another Channel with getChannelCustomFields(ctx)', async () => {
        expectTypeOf(facet.getChannelCustomFields(ctx)).toEqualTypeOf<
            Promise<Partial<CustomFacetFields> | undefined>
        >();
        const channelFields = await facet.getChannelCustomFields(ctx);
        expectTypeOf(channelFields!.channelNote).toEqualTypeOf<string | null | undefined>();
        expectTypeOf(channelFields!.channelFeaturedAsset).toEqualTypeOf<Asset | null | undefined>();
    });

    it('only accepts the names of relation fields as relations', () => {
        void facet.getChannelCustomFields(ctx, { relations: ['channelFeaturedAsset'] });
        // @ts-expect-error not a relation
        void facet.getChannelCustomFields(ctx, { relations: ['channelNote'] });
        // @ts-expect-error not a custom field
        void facet.getChannelCustomFields(ctx, { relations: ['featuredAsset'] });
    });

    it('are typed on the assignment row', () => {
        expectTypeOf<FacetChannel['customFields']>().toEqualTypeOf<Partial<CustomFacetFields>>();
    });

    it('are typed per entity on every ChannelAware entity with an assignment entity', () => {
        expectTypeOf(stockLocation.getChannelCustomFields(ctx)).toEqualTypeOf<
            Promise<Partial<CustomStockLocationFields> | undefined>
        >();
    });
});
