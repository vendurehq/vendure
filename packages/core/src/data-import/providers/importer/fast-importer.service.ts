import { Injectable } from '@nestjs/common';
import {
    CreateProductInput,
    CreateProductOptionGroupInput,
    CreateProductOptionInput,
    CreateProductVariantInput,
} from '@vendure/common/lib/generated-types';
import { normalizeString } from '@vendure/common/lib/normalize-string';
import { ID } from '@vendure/common/lib/shared-types';
import { unique } from '@vendure/common/lib/unique';

import { RequestContext } from '../../../api/common/request-context';
import { TransactionalConnection } from '../../../connection/transactional-connection';
import { Channel } from '../../../entity/channel/channel.entity';
import { ProductOptionGroupTranslation } from '../../../entity/product-option-group/product-option-group-translation.entity';
import { ProductOptionGroup } from '../../../entity/product-option-group/product-option-group.entity';
import { ProductOptionTranslation } from '../../../entity/product-option/product-option-translation.entity';
import { ProductOption } from '../../../entity/product-option/product-option.entity';
import { ProductVariantAsset } from '../../../entity/product-variant/product-variant-asset.entity';
import { ProductVariantPrice } from '../../../entity/product-variant/product-variant-price.entity';
import { ProductVariantTranslation } from '../../../entity/product-variant/product-variant-translation.entity';
import { ProductVariant } from '../../../entity/product-variant/product-variant.entity';
import { ProductAsset } from '../../../entity/product/product-asset.entity';
import { ProductTranslation } from '../../../entity/product/product-translation.entity';
import { Product } from '../../../entity/product/product.entity';
import { RequestContextService } from '../../../service/helpers/request-context/request-context.service';
import { TranslatableSaver } from '../../../service/helpers/translatable-saver/translatable-saver';
import { ChannelService } from '../../../service/services/channel.service';
import { StockMovementService } from '../../../service/services/stock-movement.service';

/**
 * @description
 * A service to import entities into the database. This replaces the regular `create` methods of the service layer with faster
 * versions which skip much of the defensive checks and other DB calls which are not needed when running an import. It also
 * does not publish any events, so e.g. will not trigger search index jobs.
 *
 * In testing, the use of the FastImporterService approximately doubled the speed of bulk imports.
 *
 * @docsCategory import-export
 */
@Injectable()
export class FastImporterService {
    private defaultChannel: Channel;
    private importCtx: RequestContext;

    /** @internal */
    constructor(
        private connection: TransactionalConnection,
        private channelService: ChannelService,
        private stockMovementService: StockMovementService,
        private translatableSaver: TranslatableSaver,
        private requestContextService: RequestContextService,
    ) {}

    /**
     * @description
     * This should be called prior to any of the import methods, as it establishes the
     * default Channel as well as the context in which the new entities will be created.
     *
     * Passing a `channel` argument means that Products and ProductVariants will be assigned
     * to that Channel.
     */
    async initialize(channel?: Channel) {
        this.importCtx = channel
            ? await this.requestContextService.create({
                  apiType: 'admin',
                  channelOrToken: channel,
              })
            : RequestContext.empty();
        this.defaultChannel = await this.channelService.getDefaultChannel(this.importCtx);
    }

    async createProduct(input: CreateProductInput): Promise<ID> {
        this.ensureInitialized();
        // https://github.com/vendurehq/vendure/issues/2053
        // normalizes slug without validation for faster performance
        input.translations.map(translation => {
            translation.slug = normalizeString(translation.slug as string, '-');
        });
        const product = await this.translatableSaver.create({
            ctx: this.importCtx,
            input,
            entityType: Product,
            translationType: ProductTranslation,
            beforeSave: async p => {
                p.channels = unique([this.defaultChannel, this.importCtx.channel], 'id');
                if (input.facetValueIds) {
                    p.facetValues = input.facetValueIds.map(id => ({ id }) as any);
                }
                if (input.featuredAssetId) {
                    p.featuredAsset = { id: input.featuredAssetId } as any;
                }
            },
        });
        if (input.assetIds) {
            const productAssets = input.assetIds.map(
                (id, i) =>
                    new ProductAsset({
                        assetId: id,
                        productId: product.id,
                        position: i,
                    }),
            );
            await this.connection
                .getRepository(this.importCtx, ProductAsset)
                .save(productAssets, { reload: false });
        }
        return product.id;
    }

    async createProductOptionGroup(input: CreateProductOptionGroupInput): Promise<ID> {
        this.ensureInitialized();
        const group = await this.translatableSaver.create({
            ctx: this.importCtx,
            input,
            entityType: ProductOptionGroup,
            translationType: ProductOptionGroupTranslation,
            beforeSave: async g => {
                g.channels = unique([this.defaultChannel, this.importCtx.channel], 'id');
            },
        });
        return group.id;
    }

    async createProductOption(input: CreateProductOptionInput): Promise<ID> {
        this.ensureInitialized();
        const option = await this.translatableSaver.create({
            ctx: this.importCtx,
            input,
            entityType: ProductOption,
            translationType: ProductOptionTranslation,
            beforeSave: po => {
                po.group = { id: input.productOptionGroupId } as any;
                po.channels = unique([this.defaultChannel, this.importCtx.channel], 'id');
            },
        });
        return option.id;
    }

    async addOptionGroupToProduct(productId: ID, optionGroupId: ID) {
        this.ensureInitialized();
        await this.connection
            .getRepository(this.importCtx, Product)
            .createQueryBuilder()
            .relation('optionGroups')
            .of(productId)
            .add(optionGroupId);
    }

    async createProductVariant(input: CreateProductVariantInput): Promise<ID> {
        this.ensureInitialized();
        if (!input.optionIds) {
            input.optionIds = [];
        }
        if (input.price == null) {
            input.price = 0;
        }

        const inputWithoutPrice = {
            ...input,
        };
        delete inputWithoutPrice.price;

        const createdVariant = await this.translatableSaver.create({
            ctx: this.importCtx,
            input: inputWithoutPrice,
            entityType: ProductVariant,
            translationType: ProductVariantTranslation,
            beforeSave: async variant => {
                variant.channels = unique([this.defaultChannel, this.importCtx.channel], 'id');
                const { optionIds } = input;
                if (optionIds && optionIds.length) {
                    variant.options = optionIds.map(id => ({ id }) as any);
                }
                if (input.facetValueIds) {
                    variant.facetValues = input.facetValueIds.map(id => ({ id }) as any);
                }
                variant.product = { id: input.productId } as any;
                variant.taxCategory = { id: input.taxCategoryId } as any;
                if (input.featuredAssetId) {
                    variant.featuredAsset = { id: input.featuredAssetId } as any;
                }
            },
        });
        if (input.assetIds) {
            const variantAssets = input.assetIds.map(
                (id, i) =>
                    new ProductVariantAsset({
                        assetId: id,
                        productVariantId: createdVariant.id,
                        position: i,
                    }),
            );
            await this.connection
                .getRepository(this.importCtx, ProductVariantAsset)
                .save(variantAssets, { reload: false });
        }
        await this.stockMovementService.adjustProductVariantStock(
            this.importCtx,
            createdVariant.id,
            input.stockLevels ?? input.stockOnHand ?? 0,
        );
        const assignedChannelIds = unique([this.defaultChannel, this.importCtx.channel], 'id').map(c => c.id);
        for (const channelId of assignedChannelIds) {
            const variantPrice = new ProductVariantPrice({
                price: input.price,
                channelId,
                currencyCode: this.defaultChannel.defaultCurrencyCode,
            });
            variantPrice.variant = createdVariant;
            await this.connection
                .getRepository(this.importCtx, ProductVariantPrice)
                .save(variantPrice, { reload: false });
        }

        return createdVariant.id;
    }

    private ensureInitialized() {
        if (!this.defaultChannel || !this.importCtx) {
            throw new Error(
                "The FastImporterService must be initialized with a call to 'initialize()' before importing data",
            );
        }
    }
}
