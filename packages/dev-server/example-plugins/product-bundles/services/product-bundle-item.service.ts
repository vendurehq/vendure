import { Injectable } from '@nestjs/common';
import { DeletionResponse, DeletionResult } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';
import { ListQueryBuilder, patchEntity, RequestContext, TransactionalConnection } from '@vendure/core';

import { ProductBundleItem } from '../entities/product-bundle-item.entity';
import { ProductBundle } from '../entities/product-bundle.entity';
import { CreateProductBundleItemInput, UpdateProductBundleItemInput } from '../types';

@Injectable()
export class ProductBundleItemService {
    constructor(
        private connection: TransactionalConnection,
        private listQueryBuilder: ListQueryBuilder,
    ) {}

    async createProductBundleItem(
        ctx: RequestContext,
        input: CreateProductBundleItemInput,
    ): Promise<ProductBundleItem> {
        const bundle = await this.connection.getEntityOrThrow(ctx, ProductBundle, input.bundleId);
        const newEntity = await this.connection.getRepository(ctx, ProductBundleItem).save(
            new ProductBundleItem({
                ...input,
                bundle,
            }),
        );

        return newEntity;
    }

    async updateProductBundleItem(
        ctx: RequestContext,
        input: UpdateProductBundleItemInput,
    ): Promise<ProductBundleItem> {
        const entity = await this.connection.getEntityOrThrow(ctx, ProductBundleItem, input.id);
        const updatedEntity = patchEntity(entity, input);
        await this.connection.getRepository(ctx, ProductBundleItem).save(updatedEntity, { reload: false });
        return updatedEntity;
    }

    async delete(ctx: RequestContext, id: ID): Promise<DeletionResponse> {
        const entity = await this.connection.getEntityOrThrow(ctx, ProductBundleItem, id);
        try {
            await this.connection.getRepository(ctx, ProductBundleItem).remove(entity);
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
}
