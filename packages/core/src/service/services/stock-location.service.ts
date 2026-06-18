import { Injectable } from '@nestjs/common';
import {
    AssignStockLocationsToChannelInput,
    CreateStockLocationInput,
    DeleteStockLocationInput,
    DeletionResponse,
    DeletionResult,
    Permission,
    RemoveStockLocationsFromChannelInput,
    UpdateStockLocationInput,
} from '@vendure/common/lib/generated-types';
import { ID, PaginatedList } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../api/common/request-context';
import { RelationPaths } from '../../api/decorators/relations.decorator';
import { RequestContextCacheService } from '../../cache/request-context-cache.service';
import { EntityNotFoundError, ForbiddenError, UserInputError } from '../../common/error/errors';
import { Instrument } from '../../common/instrument-decorator';
import { ListQueryOptions } from '../../common/types/common-types';
import { assertFound, idsAreEqual } from '../../common/utils';
import { ConfigService } from '../../config/config.service';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { OrderLine } from '../../entity/order-line/order-line.entity';
import { StockLevel } from '../../entity/stock-level/stock-level.entity';
import { StockLocation } from '../../entity/stock-location/stock-location.entity';
import { EventBus, StockLocationEvent } from '../../event-bus/index';
import { CustomFieldRelationService } from '../helpers/custom-field-relation/custom-field-relation.service';
import { ListQueryBuilder } from '../helpers/list-query-builder/list-query-builder';
import { RequestContextService } from '../helpers/request-context/request-context.service';
import { patchEntity } from '../helpers/utils/patch-entity';

import { ChannelService } from './channel.service';
import { RoleService } from './role.service';

/**
 * @description
 * Contains methods relating to {@link StockLocation} entities.
 *
 * @docsCategory services
 */
@Injectable()
@Instrument()
export class StockLocationService {
    constructor(
        private requestContextService: RequestContextService,
        private connection: TransactionalConnection,
        private channelService: ChannelService,
        private roleService: RoleService,
        private listQueryBuilder: ListQueryBuilder,
        private configService: ConfigService,
        private requestContextCache: RequestContextCacheService,
        private customFieldRelationService: CustomFieldRelationService,
        private eventBus: EventBus,
    ) {}

    async initStockLocations() {
        await this.ensureDefaultStockLocationExists();
    }

    findOne(ctx: RequestContext, stockLocationId: ID): Promise<StockLocation | undefined> {
        return this.connection
            .findOneInChannel(ctx, StockLocation, stockLocationId, ctx.channelId)
            .then(result => result ?? undefined);
    }

    findAll(
        ctx: RequestContext,
        options?: ListQueryOptions<StockLocation>,
        relations?: RelationPaths<StockLocation>,
    ): Promise<PaginatedList<StockLocation>> {
        return this.listQueryBuilder
            .build(StockLocation, options, {
                channelId: ctx.channelId,
                relations,
                ctx,
            })
            .getManyAndCount()
            .then(([items, totalItems]) => ({
                items,
                totalItems,
            }));
    }

    async create(ctx: RequestContext, input: CreateStockLocationInput): Promise<StockLocation> {
        const stockLocation = await this.connection.getRepository(ctx, StockLocation).save(
            new StockLocation({
                name: input.name,
                description: input.description ?? '',
                customFields: input.customFields ?? {},
            }),
        );
        await this.channelService.assignToCurrentChannel(stockLocation, ctx);
        await this.connection.getRepository(ctx, StockLocation).save(stockLocation);
        await this.eventBus.publish(new StockLocationEvent(ctx, stockLocation, 'created', input));
        return stockLocation;
    }

    async update(ctx: RequestContext, input: UpdateStockLocationInput): Promise<StockLocation> {
        const stockLocation = await this.connection.getEntityOrThrow(ctx, StockLocation, input.id);
        const updatedStockLocation = patchEntity(stockLocation, input);
        await this.connection.getRepository(ctx, StockLocation).save(updatedStockLocation);
        await this.customFieldRelationService.updateRelations(
            ctx,
            StockLocation,
            input,
            updatedStockLocation,
        );
        await this.eventBus.publish(new StockLocationEvent(ctx, updatedStockLocation, 'updated', input));
        return assertFound(this.findOne(ctx, updatedStockLocation.id));
    }

    /**
     * @description
     * Deletes a StockLocation. If `transferToLocationId` is specified in the input, all stock levels
     * from the deleted location will be transferred to the target location. The last StockLocation
     * cannot be deleted.
     */
    async delete(ctx: RequestContext, input: DeleteStockLocationInput): Promise<DeletionResponse> {
        const stockLocation = await this.connection.findOneInChannel(
            ctx,
            StockLocation,
            input.id,
            ctx.channelId,
        );
        if (!stockLocation) {
            throw new EntityNotFoundError('StockLocation', input.id);
        }
        // Do not allow the last StockLocation to be deleted
        const allStockLocations = await this.connection.getRepository(ctx, StockLocation).find();
        if (allStockLocations.length === 1) {
            return {
                result: DeletionResult.NOT_DELETED,
                message: ctx.translate('message.cannot-delete-last-stock-location'),
            };
        }
        if (input.transferToLocationId) {
            // This is inefficient, and it would be nice to be able to do this as a single
            // SQL `update` statement with a nested `select` subquery, but TypeORM doesn't
            // seem to have a good solution for that. If this proves a perf bottleneck, we
            // can look at implementing raw SQL with a switch over the DB type.
            const stockLevelsToTransfer = await this.connection
                .getRepository(ctx, StockLevel)
                .find({ where: { stockLocationId: stockLocation.id } });
            for (const stockLevel of stockLevelsToTransfer) {
                const existingStockLevel = await this.connection.getRepository(ctx, StockLevel).findOne({
                    where: {
                        stockLocationId: input.transferToLocationId,
                        productVariantId: stockLevel.productVariantId,
                    },
                });
                if (existingStockLevel) {
                    existingStockLevel.stockOnHand += stockLevel.stockOnHand;
                    existingStockLevel.stockAllocated += stockLevel.stockAllocated;
                    await this.connection.getRepository(ctx, StockLevel).save(existingStockLevel);
                } else {
                    const newStockLevel = new StockLevel({
                        productVariantId: stockLevel.productVariantId,
                        stockLocationId: input.transferToLocationId,
                        stockOnHand: stockLevel.stockOnHand,
                        stockAllocated: stockLevel.stockAllocated,
                    });
                    await this.connection.getRepository(ctx, StockLevel).save(newStockLevel);
                }
                await this.connection.getRepository(ctx, StockLevel).remove(stockLevel);
            }
        }
        try {
            const deletedStockLocation = new StockLocation(stockLocation);
            await this.connection.getRepository(ctx, StockLocation).remove(stockLocation);
            await this.eventBus.publish(
                new StockLocationEvent(ctx, deletedStockLocation, 'deleted', input.id),
            );
        } catch (e: any) {
            return {
                result: DeletionResult.NOT_DELETED,
                message: e.message,
            };
        }
        return {
            result: DeletionResult.DELETED,
        };
    }

    /**
     * @description
     * Assigns multiple StockLocations to the specified Channel. Requires the `UpdateStockLocation`
     * permission on the target channel.
     */
    async assignStockLocationsToChannel(
        ctx: RequestContext,
        input: AssignStockLocationsToChannelInput,
    ): Promise<StockLocation[]> {
        const hasPermission = await this.roleService.userHasAnyPermissionsOnChannel(ctx, input.channelId, [
            Permission.UpdateStockLocation,
        ]);
        if (!hasPermission) {
            throw new ForbiddenError();
        }
        for (const stockLocationId of input.stockLocationIds) {
            const stockLocation = await this.connection.findOneInChannel(
                ctx,
                StockLocation,
                stockLocationId,
                ctx.channelId,
            );
            await this.channelService.assignToChannels(ctx, StockLocation, stockLocationId, [
                input.channelId,
            ]);
        }
        return this.connection.findByIdsInChannel(
            ctx,
            StockLocation,
            input.stockLocationIds,
            ctx.channelId,
            {},
        );
    }

    /**
     * @description
     * Removes multiple StockLocations from the specified Channel. Requires the `DeleteStockLocation`
     * permission on the target channel. StockLocations cannot be removed from the default channel.
     */
    async removeStockLocationsFromChannel(
        ctx: RequestContext,
        input: RemoveStockLocationsFromChannelInput,
    ): Promise<StockLocation[]> {
        const hasPermission = await this.roleService.userHasAnyPermissionsOnChannel(ctx, input.channelId, [
            Permission.DeleteStockLocation,
        ]);
        if (!hasPermission) {
            throw new ForbiddenError();
        }
        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        if (idsAreEqual(input.channelId, defaultChannel.id)) {
            throw new UserInputError('error.items-cannot-be-removed-from-default-channel');
        }
        for (const stockLocationId of input.stockLocationIds) {
            const stockLocation = await this.connection.getEntityOrThrow(ctx, StockLocation, stockLocationId);
            await this.channelService.removeFromChannels(ctx, StockLocation, stockLocationId, [
                input.channelId,
            ]);
        }
        return this.connection.findByIdsInChannel(
            ctx,
            StockLocation,
            input.stockLocationIds,
            ctx.channelId,
            {},
        );
    }

    private getAllStockLocations(ctx: RequestContext) {
        return this.requestContextCache.get(ctx, 'StockLocationService.getAllStockLocations', () =>
            this.connection.getRepository(ctx, StockLocation).find(),
        );
    }

    defaultStockLocation(ctx: RequestContext) {
        return this.connection
            .getRepository(ctx, StockLocation)
            .find({ order: { createdAt: 'ASC' } })
            .then(items => items[0]);
    }

    /**
     * @description
     * Returns the locations and quantities to use for allocating stock when an OrderLine is created.
     * This uses the configured {@link StockLocationStrategy}.
     */
    async getAllocationLocations(ctx: RequestContext, orderLine: OrderLine, quantity: number) {
        const { stockLocationStrategy } = this.configService.catalogOptions;
        const stockLocations = await this.getAllStockLocations(ctx);
        const allocationLocations = await stockLocationStrategy.forAllocation(
            ctx,
            stockLocations,
            orderLine,
            quantity,
        );
        return allocationLocations;
    }

    /**
     * @description
     * Returns the locations and quantities to use for releasing allocated stock when an OrderLine is cancelled
     * or modified. This uses the configured {@link StockLocationStrategy}.
     */
    async getReleaseLocations(ctx: RequestContext, orderLine: OrderLine, quantity: number) {
        const { stockLocationStrategy } = this.configService.catalogOptions;
        const stockLocations = await this.getAllStockLocations(ctx);
        const releaseLocations = await stockLocationStrategy.forRelease(
            ctx,
            stockLocations,
            orderLine,
            quantity,
        );
        return releaseLocations;
    }

    /**
     * @description
     * Returns the locations and quantities to use for creating sales when an Order is fulfilled.
     * This uses the configured {@link StockLocationStrategy}.
     */
    async getSaleLocations(ctx: RequestContext, orderLine: OrderLine, quantity: number) {
        const { stockLocationStrategy } = this.configService.catalogOptions;
        const stockLocations = await this.getAllStockLocations(ctx);
        const saleLocations = await stockLocationStrategy.forSale(ctx, stockLocations, orderLine, quantity);
        return saleLocations;
    }

    /**
     * @description
     * Returns the locations and quantities to use for cancelling sales when an OrderLine is cancelled
     * after fulfillment. This uses the configured {@link StockLocationStrategy}.
     */
    async getCancellationLocations(ctx: RequestContext, orderLine: OrderLine, quantity: number) {
        const { stockLocationStrategy } = this.configService.catalogOptions;
        const stockLocations = await this.getAllStockLocations(ctx);
        const cancellationLocations = await stockLocationStrategy.forCancellation(
            ctx,
            stockLocations,
            orderLine,
            quantity,
        );
        return cancellationLocations;
    }

    private async ensureDefaultStockLocationExists() {
        const ctx = await this.requestContextService.create({
            apiType: 'admin',
        });
        const stockLocations = await this.connection.getRepository(ctx, StockLocation).find({
            relations: {
                channels: true,
            },
        });
        if (stockLocations.length === 0) {
            const defaultStockLocation = await this.connection.getRepository(ctx, StockLocation).save(
                new StockLocation({
                    name: 'Default Stock Location',
                    description: 'The default stock location',
                }),
            );
            defaultStockLocation.channels = [];
            stockLocations.push(defaultStockLocation);
            await this.connection.getRepository(ctx, StockLocation).save(defaultStockLocation);
        }
        const defaultChannel = await this.channelService.getDefaultChannel();
        for (const stockLocation of stockLocations) {
            if (!stockLocation.channels.find(c => c.id === defaultChannel.id)) {
                await this.channelService.assignToChannels(ctx, StockLocation, stockLocation.id, [
                    defaultChannel.id,
                ]);
            }
        }
    }
}
