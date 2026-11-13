import { describe, expectTypeOf, it } from 'vitest';

import { RequestContext } from '../../api/common/request-context';
import { Asset } from '../asset/asset.entity';
import { CustomProductChannelFields, CustomStockLocationChannelFields } from '../custom-entity-fields';
import { Product } from '../product/product.entity';
import { StockLocation } from '../stock-location/stock-location.entity';

import { ProductChannel } from './channel-assignment.entities';

// Augmentations apply to the whole type-check program, so only CustomProductChannelFields, which
// no other code constructs, is augmented here.
declare module '../custom-entity-fields' {
    interface CustomProductChannelFields {
        channelNote: string | null;
        channelFeaturedAsset: Asset | null;
    }
}

declare const ctx: RequestContext;
declare const product: Product;
declare const stockLocation: StockLocation;

// #490: channel-scoped custom fields are not on the entity, so the type system makes code read them
// with getChannelCustomFields() rather than from `customFields`, where they would be undefined.
describe('channel-scoped custom fields of Product (#490)', () => {
    it('are not part of customFields', () => {
        // @ts-expect-error channel-scoped fields are declared on CustomProductChannelFields
        product.customFields.channelNote;
    });

    it('are read with getChannelCustomFields(ctx)', async () => {
        expectTypeOf(product.getChannelCustomFields(ctx)).toEqualTypeOf<
            Promise<CustomProductChannelFields | undefined>
        >();
        const channelFields = await product.getChannelCustomFields(ctx);
        expectTypeOf(channelFields!.channelNote).toEqualTypeOf<string | null>();
        expectTypeOf(channelFields!.channelFeaturedAsset).toEqualTypeOf<Asset | null>();
    });

    it('only accepts the names of the fields as relations', () => {
        void product.getChannelCustomFields(ctx, { relations: ['channelFeaturedAsset'] });
        // @ts-expect-error not a channel-scoped field
        void product.getChannelCustomFields(ctx, { relations: ['featuredAsset'] });
    });

    it('are typed on the assignment row', () => {
        expectTypeOf<ProductChannel['customFields']>().toEqualTypeOf<CustomProductChannelFields>();
    });

    it('are typed per entity on every ChannelAware entity with an assignment entity', () => {
        expectTypeOf(stockLocation.getChannelCustomFields(ctx)).toEqualTypeOf<
            Promise<CustomStockLocationChannelFields | undefined>
        >();
    });
});
