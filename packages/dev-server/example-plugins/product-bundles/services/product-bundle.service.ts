import { Injectable } from '@nestjs/common';
import { UpdateOrderItemsResult } from '@vendure/common/lib/generated-shop-types';
import { DeletionResponse, DeletionResult } from '@vendure/common/lib/generated-types';
import { ID, PaginatedList } from '@vendure/common/lib/shared-types';
import {
    assertFound,
    EntityHydrator,
    ErrorResultUnion,
    ListQueryBuilder,
    ListQueryOptions,
    Order,
    OrderService,
    patchEntity,
    RelationPaths,
    RequestContext,
    TransactionalConnection,
} from '@vendure/core';

import { ProductBundle } from '../entities/product-bundle.entity';
import { CreateProductBundleInput, UpdateProductBundleInput } from '../types';

@Injectable()
export class ProductBundleService {
    constructor(
        private connection: TransactionalConnection,
        private listQueryBuilder: ListQueryBuilder,
        private orderService: OrderService,
        private entityHydrator: EntityHydrator,
    ) {}

    findAll(
        ctx: RequestContext,
        options?: ListQueryOptions<ProductBundle>,
        relations?: RelationPaths<ProductBundle>,
    ): Promise<PaginatedList<ProductBundle>> {
        return this.listQueryBuilder
            .build(ProductBundle, options, {
                relations,
                ctx,
            })
            .getManyAndCount()
            .then(([items, totalItems]) => {
                return {
                    items,
                    totalItems,
                };
            });
    }

    findOne(
        ctx: RequestContext,
        id: ID,
        relations?: RelationPaths<ProductBundle>,
    ): Promise<ProductBundle | null> {
        return this.connection.getRepository(ctx, ProductBundle).findOne({
            where: { id },
            relations,
        });
    }

    async create(ctx: RequestContext, input: CreateProductBundleInput): Promise<ProductBundle> {
        const newEntity = await this.connection.getRepository(ctx, ProductBundle).save(input);
        return assertFound(this.findOne(ctx, newEntity.id));
    }

    async update(ctx: RequestContext, input: UpdateProductBundleInput): Promise<ProductBundle> {
        const entity = await this.connection.getEntityOrThrow(ctx, ProductBundle, input.id);
        const updatedEntity = patchEntity(entity, input);
        await this.connection.getRepository(ctx, ProductBundle).save(updatedEntity, { reload: false });
        return assertFound(this.findOne(ctx, updatedEntity.id));
    }

    async delete(ctx: RequestContext, id: ID): Promise<DeletionResponse> {
        const entity = await this.connection.getEntityOrThrow(ctx, ProductBundle, id);
        try {
            await this.connection.getRepository(ctx, ProductBundle).remove(entity);
            return {
                result: DeletionResult.DELETED,
            };
        } catch (e: any) {
            return {
                result: DeletionResult.NOT_DELETED,
                message: e.toString(),
            };
        }
    }

    async addProductBundleToOrder(
        ctx: RequestContext,
        order: Order,
        bundleId: ID,
    ): Promise<ErrorResultUnion<UpdateOrderItemsResult, Order>> {
        const bundle = await this.connection.getEntityOrThrow(ctx, ProductBundle, bundleId, {
            relations: {
                items: true,
            },
        });

        const result = await this.orderService.addItemsToOrder(
            ctx,
            order.id,
            bundle.items.map(item => ({
                productVariantId: item.productVariant.id,
                quantity: item.quantity,
                customFields: {
                    fromBundle: {
                        bundleId: bundleId.toString(),
                        bundleName: bundle.name,
                    },
                },
            })),
        );

        if (result.errorResults.length) {
            await this.connection.rollBackTransaction(ctx);
            return result.errorResults[0];
        }

        return result.order;
    }

    async removeProductBundleFromOrder(
        ctx: RequestContext,
        order: Order,
        bundleId: ID,
    ): Promise<ErrorResultUnion<UpdateOrderItemsResult, Order>> {
        await this.entityHydrator.hydrate(ctx, order, {
            relations: ['lines'],
        });
        const bundle = await this.connection.getEntityOrThrow(ctx, ProductBundle, bundleId, {
            relations: {
                items: true,
            },
        });

        const adjustment: Array<{ orderLineId: ID; quantity: number }> = [];
        for (const line of order.lines) {
            if (line.customFields?.fromBundle?.bundleId === bundleId.toString()) {
                const bundleItem = bundle.items.find(
                    item => item.productVariant.id === line.productVariant.id,
                );
                if (bundleItem) {
                    adjustment.push({
                        orderLineId: line.id,
                        quantity: -bundleItem.quantity,
                    });
                }
            }
        }

        const result = await this.orderService.adjustOrderLines(ctx, order.id, adjustment);

        if (result.errorResults.length) {
            await this.connection.rollBackTransaction(ctx);
            return result.errorResults[0];
        }

        return result.order;
    }
}
