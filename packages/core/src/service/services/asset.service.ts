import { Injectable } from '@nestjs/common';
import {
    AssetListOptions,
    AssetType,
    AssignAssetsToChannelInput,
    CreateAssetInput,
    DeletionResponse,
    DeletionResult,
    LanguageCode,
    LogicalOperator,
    Permission,
    UpdateAssetInput,
} from '@vendure/common/lib/generated-types';
import { omit } from '@vendure/common/lib/omit';
import { ID, PaginatedList, Type } from '@vendure/common/lib/shared-types';
import { notNullOrUndefined } from '@vendure/common/lib/shared-utils';
import { unique } from '@vendure/common/lib/unique';
import { ReadStream as FSReadStream } from 'fs';
import { ReadStream } from 'fs-extra';
import { IncomingMessage } from 'http';
import { imageSize } from 'image-size';
import mime from 'mime-types';
import path from 'path';
import { Readable, Stream } from 'stream';
import { IsNull } from 'typeorm';
import { FindOneOptions } from 'typeorm/find-options/FindOneOptions';
import { camelCase } from 'typeorm/util/StringUtils';

import { RequestContext } from '../../api/common/request-context';
import { RelationPaths } from '../../api/decorators/relations.decorator';
import { Instrument } from '../../common';
import { isGraphQlErrorResult } from '../../common/error/error-result';
import { ForbiddenError, InternalServerError } from '../../common/error/errors';
import { MimeTypeError } from '../../common/error/generated-graphql-admin-errors';
import { ChannelAware } from '../../common/types/common-types';
import { Translated } from '../../common/types/locale-types';
import { getAssetType, idsAreEqual } from '../../common/utils';
import { ConfigService } from '../../config/config.service';
import { Logger } from '../../config/logger/vendure-logger';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { AssetTranslation } from '../../entity/asset/asset-translation.entity';
import { Asset } from '../../entity/asset/asset.entity';
import { OrderableAsset } from '../../entity/asset/orderable-asset.entity';
import { VendureEntity } from '../../entity/base/base.entity';
import { Collection } from '../../entity/collection/collection.entity';
import { ProductVariant } from '../../entity/product-variant/product-variant.entity';
import { Product } from '../../entity/product/product.entity';
import { EventBus } from '../../event-bus/event-bus';
import { AssetChannelEvent } from '../../event-bus/events/asset-channel-event';
import { AssetEvent } from '../../event-bus/events/asset-event';
import { CustomFieldRelationService } from '../helpers/custom-field-relation/custom-field-relation.service';
import { ListQueryBuilder } from '../helpers/list-query-builder/list-query-builder';
import { TranslatableSaver } from '../helpers/translatable-saver/translatable-saver';
import { TranslatorService } from '../helpers/translator/translator.service';
import { patchEntity } from '../helpers/utils/patch-entity';

import { ChannelService } from './channel.service';
import { RoleService } from './role.service';
import { TagService } from './tag.service';

/**
 * @description
 * Certain entities (Product, ProductVariant, Collection) use this interface
 * to model a featured asset and then a list of assets with a defined order.
 *
 * @docsCategory services
 * @docsPage AssetService
 */
export interface EntityWithAssets extends VendureEntity {
    featuredAsset: Asset | null;
    assets: OrderableAsset[];
}

/**
 * @description
 * Used when updating entities which implement {@link EntityWithAssets}.
 *
 * @docsCategory services
 * @docsPage AssetService
 */
export interface EntityAssetInput {
    assetIds?: ID[] | null;
    featuredAssetId?: ID | null;
}

/**
 * @description
 * Contains methods relating to {@link Asset} entities.
 *
 * @docsCategory services
 * @docsWeight 0
 */
@Injectable()
@Instrument()
export class AssetService {
    private permittedMimeTypes: Array<{ type: string; subtype: string }> = [];

    constructor(
        private connection: TransactionalConnection,
        private configService: ConfigService,
        private listQueryBuilder: ListQueryBuilder,
        private eventBus: EventBus,
        private tagService: TagService,
        private channelService: ChannelService,
        private roleService: RoleService,
        private customFieldRelationService: CustomFieldRelationService,
        private readonly translatableSaver: TranslatableSaver,
        private readonly translator: TranslatorService,
    ) {
        this.permittedMimeTypes = this.configService.assetOptions.permittedFileTypes
            .map(val => (/\.[\w]+/.test(val) ? mime.lookup(val) || undefined : val))
            .filter(notNullOrUndefined)
            .map(val => {
                const [type, subtype] = val.split('/');
                return { type, subtype };
            });
    }

    findOne(
        ctx: RequestContext,
        id: ID,
        relations?: RelationPaths<Asset>,
    ): Promise<Translated<Asset> | undefined> {
        return this.connection
            .findOneInChannel(ctx, Asset, id, ctx.channelId, {
                relations: relations ?? [],
            })
            .then(result => (result ? this.translator.translate(result, ctx) : undefined));
    }

    findAll(
        ctx: RequestContext,
        options?: AssetListOptions,
        relations?: RelationPaths<Asset>,
    ): Promise<PaginatedList<Translated<Asset>>> {
        const qb = this.listQueryBuilder.build(Asset, options, {
            ctx,
            relations: [...(relations ?? []), 'tags'],
            channelId: ctx.channelId,
        });
        const tags = options?.tags;
        if (tags && tags.length) {
            const operator = options?.tagsOperator ?? LogicalOperator.AND;
            const subquery = qb.connection
                .createQueryBuilder()
                .select('asset.id')
                .from(Asset, 'asset')
                .leftJoin('asset.tags', 'tags')
                .where('tags.value IN (:...tags)');

            if (operator === LogicalOperator.AND) {
                subquery.groupBy('asset.id').having('COUNT(asset.id) = :tagCount');
            }

            qb.andWhere(`asset.id IN (${subquery.getQuery()})`).setParameters({
                tags,
                tagCount: tags.length,
            });
        }
        return qb.getManyAndCount().then(([items, totalItems]) => ({
            items: items.map(asset => this.translator.translate(asset, ctx)),
            totalItems,
        }));
    }

    async getFeaturedAsset<T extends Omit<EntityWithAssets, 'assets'>>(
        ctx: RequestContext,
        entity: T,
    ): Promise<Asset | undefined> {
        const entityType: Type<T> = Object.getPrototypeOf(entity).constructor;
        let entityWithFeaturedAsset: T | undefined;

        if (this.channelService.isChannelAware(entity)) {
            entityWithFeaturedAsset = await this.connection.findOneInChannel(
                ctx,
                entityType as Type<T & ChannelAware>,
                entity.id,
                ctx.channelId,
                {
                    relations: ['featuredAsset'],
                    loadEagerRelations: false,
                },
            );
        } else {
            entityWithFeaturedAsset = await this.connection
                .getRepository(ctx, entityType)
                .findOne({
                    where: { id: entity.id },
                    relations: {
                        featuredAsset: true,
                    },
                    loadEagerRelations: false,
                    // TODO: satisfies
                } as FindOneOptions<T>)
                .then(result => result ?? undefined);
        }
        return (entityWithFeaturedAsset && entityWithFeaturedAsset.featuredAsset) || undefined;
    }

    /**
     * @description
     * Returns the Assets of an entity which has a well-ordered list of Assets, such as Product,
     * ProductVariant or Collection.
     */
    async getEntityAssets<T extends EntityWithAssets>(
        ctx: RequestContext,
        entity: T,
    ): Promise<Asset[] | undefined> {
        let orderableAssets = entity.assets;
        if (!orderableAssets) {
            const entityType: Type<EntityWithAssets> = Object.getPrototypeOf(entity).constructor;
            const entityWithAssets = await this.connection
                .getRepository(ctx, entityType)
                .createQueryBuilder('entity')
                .leftJoinAndSelect('entity.assets', 'orderable_asset')
                .leftJoinAndSelect('orderable_asset.asset', 'asset')
                .leftJoinAndSelect('asset.translations', 'asset_translations')
                .leftJoinAndSelect('asset.channels', 'asset_channel')
                .where('entity.id = :id', { id: entity.id })
                .andWhere('asset_channel.id = :channelId', { channelId: ctx.channelId })
                .getOne();

            orderableAssets = entityWithAssets?.assets ?? [];
        } else if (0 < orderableAssets.length) {
            // the Assets are already loaded, but we need to limit them by Channel
            if (orderableAssets[0].asset?.channels) {
                orderableAssets = orderableAssets.filter(
                    a => !!a.asset.channels.map(c => c.id).find(id => idsAreEqual(id, ctx.channelId)),
                );
            } else {
                const assetsInChannel = await this.connection
                    .getRepository(ctx, Asset)
                    .createQueryBuilder('asset')
                    .leftJoinAndSelect('asset.channels', 'asset_channel')
                    .where('asset.id IN (:...ids)', { ids: orderableAssets.map(a => a.assetId) })
                    .andWhere('asset_channel.id = :channelId', { channelId: ctx.channelId })
                    .getMany();

                orderableAssets = orderableAssets.filter(
                    oa => !!assetsInChannel.find(a => idsAreEqual(a.id, oa.assetId)),
                );
            }
        } else {
            orderableAssets = [];
        }
        return orderableAssets.sort((a, b) => a.position - b.position).map(a => a.asset);
    }

    async updateFeaturedAsset<T extends EntityWithAssets>(
        ctx: RequestContext,
        entity: T,
        input: EntityAssetInput,
    ): Promise<T> {
        const { assetIds, featuredAssetId } = input;
        if (featuredAssetId === null || (assetIds && assetIds.length === 0)) {
            entity.featuredAsset = null;
            return entity;
        }
        if (featuredAssetId === undefined) {
            return entity;
        }
        const featuredAsset = await this.findOne(ctx, featuredAssetId);
        if (featuredAsset) {
            entity.featuredAsset = featuredAsset;
        }
        return entity;
    }

    /**
     * @description
     * Updates the assets / featuredAsset of an entity, ensuring that only valid assetIds are used.
     */
    async updateEntityAssets<T extends EntityWithAssets>(
        ctx: RequestContext,
        entity: T,
        input: EntityAssetInput,
    ): Promise<T> {
        if (!entity.id) {
            throw new InternalServerError('error.entity-must-have-an-id');
        }
        const { assetIds } = input;
        if (assetIds && assetIds.length) {
            const assets = await this.connection.findByIdsInChannel(ctx, Asset, assetIds, ctx.channelId, {});
            const sortedAssets = assetIds
                .map(id => assets.find(a => idsAreEqual(a.id, id)))
                .filter(notNullOrUndefined);
            await this.removeExistingOrderableAssets(ctx, entity);
            if (sortedAssets.length > 0) {
                entity.assets = await this.createOrderableAssets(ctx, entity, sortedAssets);
            } else {
                entity.assets = [];
            }
        } else if (assetIds && assetIds.length === 0) {
            await this.removeExistingOrderableAssets(ctx, entity);
        }
        return entity;
    }

    /**
     * @description
     * Create an Asset based on a file uploaded via the GraphQL API. The file should be uploaded
     * using the [GraphQL multipart request specification](https://github.com/jaydenseric/graphql-multipart-request-spec),
     * e.g. using the [apollo-upload-client](https://github.com/jaydenseric/apollo-upload-client) npm package.
     *
     * See the [Uploading Files docs](/developer-guide/uploading-files) for an example of usage.
     */
    async create(ctx: RequestContext, input: CreateAssetInput): Promise<Translated<Asset> | MimeTypeError> {
        const { createReadStream, filename, mimetype } = await input.file;
        const { stream, errorPromise } = this.makeStreamGuard(createReadStream);
        const result = await Promise.race([
            this.createAssetInternal(ctx, stream, filename, mimetype, input.customFields, input.translations),
            errorPromise,
        ]);
        if (isGraphQlErrorResult(result)) {
            return result;
        }
        await this.customFieldRelationService.updateRelations(ctx, Asset, input, result);
        if (input.tags) {
            const tags = await this.tagService.valuesToTags(ctx, input.tags);
            result.tags = tags;
            await this.connection.getRepository(ctx, Asset).save(result);
        }
        const translatedAsset = this.translator.translate(result, ctx);
        await this.eventBus.publish(new AssetEvent(ctx, translatedAsset, 'created', input));
        return translatedAsset;
    }

    /**
     * @description
     * Updates the name, focalPoint, tags & custom fields of an Asset.
     */
    async update(ctx: RequestContext, input: UpdateAssetInput): Promise<Translated<Asset>> {
        const asset = await this.connection.getEntityOrThrow(ctx, Asset, input.id);
        if (input.focalPoint) {
            const to3dp = (x: number) => +x.toFixed(3);
            input.focalPoint.x = to3dp(input.focalPoint.x);
            input.focalPoint.y = to3dp(input.focalPoint.y);
        }
        patchEntity(asset, omit(input, ['tags', 'name', 'translations']));
        if (input.tags) {
            asset.tags = await this.tagService.valuesToTags(ctx, input.tags);
        }
        // Handle translations
        const translationsInput = input.translations ?? [];
        // For backward compatibility: if name is provided without translations, update the current language translation
        if (input.name != null && !translationsInput.some(t => t.languageCode === ctx.languageCode)) {
            translationsInput.push({ languageCode: ctx.languageCode, name: input.name });
        }
        // Save asset first to ensure it exists for translation foreign key, and so that
        // updateRelations() sees the freshly-patched scalar custom fields when it reloads
        // the entity from the DB.
        const savedAsset = await this.connection.getRepository(ctx, Asset).save(asset);
        await this.customFieldRelationService.updateRelations(ctx, Asset, input, asset);
        if (translationsInput.length > 0) {
            await this.translatableSaver.update({
                ctx,
                input: { id: savedAsset.id, translations: translationsInput },
                entityType: Asset,
                translationType: AssetTranslation,
            });
        }
        const translatedAsset = await this.findOne(ctx, savedAsset.id);
        if (!translatedAsset) {
            throw new InternalServerError('error.entity-not-found');
        }
        await this.eventBus.publish(new AssetEvent(ctx, translatedAsset, 'updated', input));
        return translatedAsset;
    }

    /**
     * @description
     * Deletes an Asset after performing checks to ensure that the Asset is not currently in use
     * by a Product, ProductVariant or Collection.
     */
    async delete(
        ctx: RequestContext,
        ids: ID[],
        force: boolean = false,
        deleteFromAllChannels: boolean = false,
    ): Promise<DeletionResponse> {
        const assets = await this.connection.findByIdsInChannel(ctx, Asset, ids, ctx.channelId, {
            relations: ['channels'],
        });
        let channelsOfAssets: ID[] = [];
        assets.forEach(a => a.channels.forEach(c => channelsOfAssets.push(c.id)));
        channelsOfAssets = unique(channelsOfAssets);
        const usageCount = {
            products: 0,
            variants: 0,
            collections: 0,
        };
        for (const asset of assets) {
            const usages = await this.findAssetUsages(ctx, asset);
            usageCount.products += usages.products.length;
            usageCount.variants += usages.variants.length;
            usageCount.collections += usages.collections.length;
        }
        const hasUsages = !!(usageCount.products || usageCount.variants || usageCount.collections);
        if (hasUsages && !force) {
            return {
                result: DeletionResult.NOT_DELETED,
                message: ctx.translate('message.asset-to-be-deleted-is-featured', {
                    assetCount: assets.length,
                    products: usageCount.products,
                    variants: usageCount.variants,
                    collections: usageCount.collections,
                }),
            };
        }
        const hasDeleteAllPermission = await this.hasDeletePermissionForChannels(ctx, channelsOfAssets);
        if (deleteFromAllChannels && !hasDeleteAllPermission) {
            throw new ForbiddenError();
        }
        if (!deleteFromAllChannels) {
            await Promise.all(
                assets.map(async asset => {
                    await this.channelService.removeFromChannels(ctx, Asset, asset.id, [ctx.channelId]);
                    await this.eventBus.publish(new AssetChannelEvent(ctx, asset, ctx.channelId, 'removed'));
                }),
            );
            const isOnlyChannel = channelsOfAssets.length === 1;
            if (isOnlyChannel) {
                // only channel, so also delete asset
                await this.deleteUnconditional(ctx, assets);
            }
            return {
                result: DeletionResult.DELETED,
            };
        }
        // This leaves us with deleteFromAllChannels with force or deleteFromAllChannels with no current usages
        await Promise.all(
            assets.map(async asset => {
                await this.channelService.removeFromChannels(ctx, Asset, asset.id, channelsOfAssets);
                await this.eventBus.publish(new AssetChannelEvent(ctx, asset, ctx.channelId, 'removed'));
            }),
        );
        return this.deleteUnconditional(ctx, assets);
    }

    async assignToChannel(
        ctx: RequestContext,
        input: AssignAssetsToChannelInput,
    ): Promise<Array<Translated<Asset>>> {
        const hasPermission = await this.roleService.userHasPermissionOnChannel(
            ctx,
            input.channelId,
            Permission.UpdateCatalog,
        );
        if (!hasPermission) {
            throw new ForbiddenError();
        }
        const assets = await this.connection.findByIdsInChannel(
            ctx,
            Asset,
            input.assetIds,
            ctx.channelId,
            {},
        );
        await Promise.all(
            assets.map(async asset => {
                await this.channelService.assignToChannels(ctx, Asset, asset.id, [input.channelId]);
                return await this.eventBus.publish(
                    new AssetChannelEvent(ctx, asset, input.channelId, 'assigned'),
                );
            }),
        );
        const updatedAssets = await this.connection.findByIdsInChannel(
            ctx,
            Asset,
            assets.map(a => a.id),
            ctx.channelId,
            {},
        );
        return updatedAssets.map(asset => this.translator.translate(asset, ctx));
    }

    /**
     * @description
     * Create an Asset from a file stream, for example to create an Asset during data import.
     */
    async createFromFileStream(
        stream: ReadStream,
        ctx?: RequestContext,
    ): Promise<Translated<Asset> | MimeTypeError>;
    async createFromFileStream(
        stream: Readable,
        filePath: string,
        ctx?: RequestContext,
    ): Promise<Translated<Asset> | MimeTypeError>;
    async createFromFileStream(
        stream: ReadStream | Readable,
        maybeFilePathOrCtx?: string | RequestContext,
        maybeCtx?: RequestContext,
    ): Promise<Translated<Asset> | MimeTypeError> {
        const { assetImportStrategy } = this.configService.importExportOptions;
        const filePathFromArgs =
            maybeFilePathOrCtx instanceof RequestContext ? undefined : maybeFilePathOrCtx;
        const filePath =
            stream instanceof ReadStream || stream instanceof FSReadStream ? stream.path : filePathFromArgs;
        if (typeof filePath === 'string') {
            const filename = path.basename(filePath).split('?')[0];
            const mimetype = this.getMimeType(stream, filename);
            const ctx =
                maybeFilePathOrCtx instanceof RequestContext
                    ? maybeFilePathOrCtx
                    : maybeCtx instanceof RequestContext
                      ? maybeCtx
                      : RequestContext.empty();
            const result = await this.createAssetInternal(ctx, stream, filename, mimetype);
            if (isGraphQlErrorResult(result)) {
                return result;
            }
            return this.translator.translate(result, ctx);
        } else {
            throw new InternalServerError('error.path-should-be-a-string-got-buffer');
        }
    }

    private getMimeType(stream: Readable, filename: string): string {
        if (stream instanceof IncomingMessage) {
            const contentType = stream.headers['content-type'];
            if (contentType) {
                return contentType;
            }
        }
        return mime.lookup(filename) || 'application/octet-stream';
    }

    /**
     * @description
     * Unconditionally delete given assets.
     * Does not remove assets from channels
     */
    private async deleteUnconditional(ctx: RequestContext, assets: Asset[]): Promise<DeletionResponse> {
        for (const asset of assets) {
            // Create a new asset so that the id is still available
            // after deletion (the .remove() method sets it to undefined)
            const deletedAsset = new Asset(asset);
            await this.connection.getRepository(ctx, Asset).remove(asset);
            try {
                await this.configService.assetOptions.assetStorageStrategy.deleteFile(asset.source);
                await this.configService.assetOptions.assetStorageStrategy.deleteFile(asset.preview);
            } catch (e: any) {
                Logger.error('error.could-not-delete-asset-file', undefined, e.stack);
            }
            await this.eventBus.publish(new AssetEvent(ctx, deletedAsset, 'deleted', deletedAsset.id));
        }
        return {
            result: DeletionResult.DELETED,
        };
    }

    /**
     * Check if current user has permissions to delete assets from all channels
     */
    private async hasDeletePermissionForChannels(ctx: RequestContext, channelIds: ID[]): Promise<boolean> {
        const permissions = await Promise.all(
            channelIds.map(async channelId => {
                return this.roleService.userHasPermissionOnChannel(ctx, channelId, Permission.DeleteCatalog);
            }),
        );
        return !permissions.includes(false);
    }

    private async createAssetInternal(
        ctx: RequestContext,
        stream: Stream,
        filename: string,
        mimetype: string,
        customFields?: { [key: string]: any },
        translations?: Array<{ languageCode: LanguageCode; name?: string | null; customFields?: any }>,
    ): Promise<Asset | MimeTypeError> {
        const { assetOptions } = this.configService;
        if (!this.validateMimeType(mimetype)) {
            return new MimeTypeError({ fileName: filename, mimeType: mimetype });
        }
        const { assetPreviewStrategy, assetStorageStrategy } = assetOptions;
        const sourceFileName = await this.getSourceFileName(ctx, filename);
        const previewFileName = await this.getPreviewFileName(ctx, sourceFileName);

        const sourceFileIdentifier = await assetStorageStrategy.writeFileFromStream(sourceFileName, stream);
        const sourceFile = await assetStorageStrategy.readFileToBuffer(sourceFileIdentifier);
        let preview: Buffer;
        try {
            preview = await assetPreviewStrategy.generatePreviewImage(ctx, mimetype, sourceFile);
        } catch (e: any) {
            const message: string = typeof e.message === 'string' ? e.message : e.message.toString();
            Logger.error(`Could not create Asset preview image: ${message}`, undefined, e.stack);
            throw e;
        }
        const previewFileIdentifier = await assetStorageStrategy.writeFileFromBuffer(
            previewFileName,
            preview,
        );
        const type = getAssetType(mimetype);
        const { width, height } = this.getDimensions(type === AssetType.IMAGE ? sourceFile : preview);

        // Save asset first
        const asset = new Asset({
            type,
            width,
            height,
            fileSize: sourceFile.byteLength,
            mimeType: mimetype,
            source: sourceFileIdentifier,
            preview: previewFileIdentifier,
            focalPoint: null,
            customFields,
        });
        await this.channelService.assignToCurrentChannel(asset, ctx);
        const savedAsset = await this.connection.getRepository(ctx, Asset).save(asset);

        // Create and save translations with the base relationship set
        // Use the original filename for the default translation name
        const defaultName = filename;
        let assetTranslations: AssetTranslation[];
        if (translations && translations.length > 0) {
            assetTranslations = translations.map(
                t =>
                    new AssetTranslation({
                        languageCode: t.languageCode,
                        name: t.name ?? defaultName,
                        customFields: t.customFields,
                        base: savedAsset,
                    }),
            );
        } else {
            // Create default translation using context language
            assetTranslations = [
                new AssetTranslation({
                    languageCode: ctx.languageCode,
                    name: defaultName,
                    base: savedAsset,
                }),
            ];
        }

        // Save translations
        const savedTranslations = await this.connection
            .getRepository(ctx, AssetTranslation)
            .save(assetTranslations);

        // Return the asset with translations eagerly loaded
        savedAsset.translations = savedTranslations;
        return savedAsset;
    }

    private async getSourceFileName(ctx: RequestContext, fileName: string): Promise<string> {
        const { assetOptions } = this.configService;
        return this.generateUniqueName(fileName, (name, conflict) =>
            assetOptions.assetNamingStrategy.generateSourceFileName(ctx, name, conflict),
        );
    }

    private async getPreviewFileName(ctx: RequestContext, fileName: string): Promise<string> {
        const { assetOptions } = this.configService;
        return this.generateUniqueName(fileName, (name, conflict) =>
            assetOptions.assetNamingStrategy.generatePreviewFileName(ctx, name, conflict),
        );
    }

    private async generateUniqueName(
        inputFileName: string,
        generateNameFn: (fileName: string, conflictName?: string) => string,
    ): Promise<string> {
        const { assetOptions } = this.configService;
        let outputFileName: string | undefined;
        do {
            outputFileName = generateNameFn(inputFileName, outputFileName);
        } while (await assetOptions.assetStorageStrategy.fileExists(outputFileName));
        return outputFileName;
    }

    private getDimensions(imageFile: Buffer): { width: number; height: number } {
        try {
            const { width, height } = imageSize(imageFile);
            return { width: width ?? 0, height: height ?? 0 };
        } catch (e: any) {
            Logger.error('Could not determine Asset dimensions: ' + JSON.stringify(e));
            return { width: 0, height: 0 };
        }
    }

    private createOrderableAssets(
        ctx: RequestContext,
        entity: EntityWithAssets,
        assets: Asset[],
    ): Promise<OrderableAsset[]> {
        const orderableAssets = assets.map((asset, i) => this.getOrderableAsset(ctx, entity, asset, i));
        return this.connection.getRepository(ctx, orderableAssets[0].constructor).save(orderableAssets);
    }

    private getOrderableAsset(
        ctx: RequestContext,
        entity: EntityWithAssets,
        asset: Asset,
        index: number,
    ): OrderableAsset {
        const entityIdProperty = this.getHostEntityIdProperty(entity);
        const orderableAssetType = this.getOrderableAssetType(ctx, entity);
        return new orderableAssetType({
            assetId: asset.id,
            position: index,
            [entityIdProperty]: entity.id,
        });
    }

    private async removeExistingOrderableAssets(ctx: RequestContext, entity: EntityWithAssets) {
        const propertyName = this.getHostEntityIdProperty(entity);
        const orderableAssetType = this.getOrderableAssetType(ctx, entity);
        await this.connection.getRepository(ctx, orderableAssetType).delete({
            [propertyName]: entity.id,
        });
    }

    private getOrderableAssetType(ctx: RequestContext, entity: EntityWithAssets): Type<OrderableAsset> {
        const assetRelation = this.connection
            .getRepository(ctx, entity.constructor)
            .metadata.relations.find(r => r.propertyName === 'assets');
        if (!assetRelation || typeof assetRelation.type === 'string') {
            throw new InternalServerError('error.could-not-find-matching-orderable-asset');
        }
        return assetRelation.type as Type<OrderableAsset>;
    }

    private getHostEntityIdProperty(entity: EntityWithAssets): string {
        const entityName = entity.constructor.name;
        switch (entityName) {
            case 'Product':
                return 'productId';
            case 'ProductVariant':
                return 'productVariantId';
            case 'Collection':
                return 'collectionId';
            default:
                return `${camelCase(entityName)}Id`;
        }
    }

    private validateMimeType(mimeType: string): boolean {
        const [type, subtype] = mimeType.split('/');
        const typeMatches = this.permittedMimeTypes.filter(t => t.type === type);

        for (const match of typeMatches) {
            if (match.subtype === subtype || match.subtype === '*') {
                return true;
            }
        }
        return false;
    }

    /**
     * Find the entities which reference the given Asset as a featuredAsset.
     */
    private async findAssetUsages(
        ctx: RequestContext,
        asset: Asset,
    ): Promise<{ products: Product[]; variants: ProductVariant[]; collections: Collection[] }> {
        const products = await this.connection.getRepository(ctx, Product).find({
            where: {
                featuredAsset: { id: asset.id },
                deletedAt: IsNull(),
            },
        });
        const variants = await this.connection.getRepository(ctx, ProductVariant).find({
            where: {
                featuredAsset: { id: asset.id },
                deletedAt: IsNull(),
            },
        });
        const collections = await this.connection.getRepository(ctx, Collection).find({
            where: {
                featuredAsset: { id: asset.id },
            },
        });
        return { products, variants, collections };
    }

    private makeStreamGuard(createReadStream: () => ReadStream): {
        stream: ReadStream;
        errorPromise: Promise<never>;
    } {
        let onReject: (err: unknown) => void;
        const errorPromise = new Promise<never>((_, rej) => {
            onReject = rej;
        });

        // `fs-capacitor`'s `createReadStream` can throw if its `WriteStream` has already been destroyed
        // sync error so will bubble to consumer immediately
        const stream = createReadStream();

        stream.on('error', err => {
            onReject(err);
        });

        return { stream, errorPromise };
    }
}
