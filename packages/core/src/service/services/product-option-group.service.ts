import { Injectable } from '@nestjs/common';
import {
    AssignProductOptionGroupsToChannelInput,
    CreateProductOptionGroupInput,
    DeletionResponse,
    DeletionResult,
    Permission,
    RemoveProductOptionGroupFromChannelResult,
    RemoveProductOptionGroupsFromChannelInput,
    UpdateProductOptionGroupInput,
} from '@vendure/common/lib/generated-types';
import { ID, PaginatedList } from '@vendure/common/lib/shared-types';
import { In, IsNull } from 'typeorm';

import { RequestContext } from '../../api/common/request-context';
import { RelationPaths } from '../../api/decorators/relations.decorator';
import { ErrorResultUnion, ForbiddenError, UserInputError } from '../../common';
import { ProductOptionGroupInUseError } from '../../common/error/generated-graphql-admin-errors';
import { Instrument } from '../../common/instrument-decorator';
import { ListQueryOptions } from '../../common/types/common-types';
import { Translated } from '../../common/types/locale-types';
import { assertFound, idsAreEqual } from '../../common/utils';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { Channel } from '../../entity/channel/channel.entity';
import { ProductOptionGroupTranslation } from '../../entity/product-option-group/product-option-group-translation.entity';
import { ProductOptionGroup } from '../../entity/product-option-group/product-option-group.entity';
import { ProductOption } from '../../entity/product-option/product-option.entity';
import { ProductVariant } from '../../entity/product-variant/product-variant.entity';
import { Product } from '../../entity/product/product.entity';
import { EventBus } from '../../event-bus';
import { ProductOptionGroupEvent } from '../../event-bus/events/product-option-group-event';
import { CustomFieldRelationService } from '../helpers/custom-field-relation/custom-field-relation.service';
import { ListQueryBuilder } from '../helpers/list-query-builder/list-query-builder';
import { TranslatableSaver } from '../helpers/translatable-saver/translatable-saver';
import { TranslatorService } from '../helpers/translator/translator.service';

import { ChannelService } from './channel.service';
import { ProductOptionService } from './product-option.service';
import { RoleService } from './role.service';

/**
 * @description
 * Contains methods relating to {@link ProductOptionGroup} entities.
 *
 * @docsCategory services
 */
@Injectable()
@Instrument()
export class ProductOptionGroupService {
    constructor(
        private connection: TransactionalConnection,
        private translatableSaver: TranslatableSaver,
        private customFieldRelationService: CustomFieldRelationService,
        private productOptionService: ProductOptionService,
        private eventBus: EventBus,
        private translator: TranslatorService,
        private listQueryBuilder: ListQueryBuilder,
        private channelService: ChannelService,
        private roleService: RoleService,
    ) {}

    findAll(
        ctx: RequestContext,
        options?: ListQueryOptions<ProductOptionGroup>,
        relations?: RelationPaths<ProductOptionGroup>,
    ): Promise<PaginatedList<Translated<ProductOptionGroup>>> {
        return this.listQueryBuilder
            .build(ProductOptionGroup, options, {
                relations: relations ?? ['options'],
                ctx,
                channelId: ctx.channelId,
                where: {
                    deletedAt: IsNull(),
                },
            })
            .getManyAndCount()
            .then(([groups, totalItems]) => ({
                items: groups.map(group => this.translator.translate(group, ctx, ['options'])),
                totalItems,
            }));
    }

    findOne(
        ctx: RequestContext,
        id: ID,
        relations?: RelationPaths<ProductOptionGroup>,
        findOneOptions?: { includeSoftDeleted: boolean },
    ): Promise<Translated<ProductOptionGroup> | undefined> {
        return this.connection
            .findOneInChannel(ctx, ProductOptionGroup, id, ctx.channelId, {
                relations: relations ?? ['options'],
            })
            .then(group => {
                if (!group) {
                    return undefined;
                }
                if (group.deletedAt && !findOneOptions?.includeSoftDeleted) {
                    return undefined;
                }
                return this.translator.translate(group, ctx, ['options']);
            });
    }

    getOptionGroupsByProductId(ctx: RequestContext, id: ID): Promise<Array<Translated<ProductOptionGroup>>> {
        return this.connection
            .getRepository(ctx, ProductOptionGroup)
            .createQueryBuilder('optionGroup')
            .leftJoinAndSelect('optionGroup.translations', 'translations')
            .leftJoinAndSelect('optionGroup.options', 'options')
            .leftJoinAndSelect('options.translations', 'optionTranslations')
            .innerJoin('optionGroup.products', 'product', 'product.id = :productId', { productId: id })
            .where('optionGroup.deletedAt IS NULL')
            .orderBy('optionGroup.id', 'ASC')
            .getMany()
            .then(groups => groups.map(group => this.translator.translate(group, ctx, ['options'])));
    }

    /**
     * @description
     * Returns all Channels to which the ProductOptionGroup is assigned.
     */
    async getOptionGroupChannels(ctx: RequestContext, optionGroupId: ID): Promise<Channel[]> {
        const optionGroup = await this.connection.getEntityOrThrow(ctx, ProductOptionGroup, optionGroupId, {
            relations: ['channels'],
            channelId: ctx.channelId,
        });
        return optionGroup.channels;
    }

    /**
     * @description
     * Returns the number of non-deleted Products in the current channel
     * that use the given ProductOptionGroup.
     */
    getProductCount(ctx: RequestContext, optionGroupId: ID): Promise<number> {
        return this.connection
            .getRepository(ctx, Product)
            .createQueryBuilder('product')
            .innerJoin('product.optionGroups', 'optionGroup', 'optionGroup.id = :optionGroupId', {
                optionGroupId,
            })
            .innerJoin('product.channels', 'channel', 'channel.id = :channelId', {
                channelId: ctx.channelId,
            })
            .where('product.deletedAt IS NULL')
            .getCount();
    }

    async create(
        ctx: RequestContext,
        input: Omit<CreateProductOptionGroupInput, 'options'>,
    ): Promise<Translated<ProductOptionGroup>> {
        const group = await this.translatableSaver.create({
            ctx,
            input,
            entityType: ProductOptionGroup,
            translationType: ProductOptionGroupTranslation,
            beforeSave: async g => {
                await this.channelService.assignToCurrentChannel(g, ctx);
            },
        });
        const groupWithRelations = await this.customFieldRelationService.updateRelations(
            ctx,
            ProductOptionGroup,
            input,
            group,
        );
        await this.eventBus.publish(new ProductOptionGroupEvent(ctx, groupWithRelations, 'created', input));
        return assertFound(this.findOne(ctx, group.id));
    }

    async update(
        ctx: RequestContext,
        input: UpdateProductOptionGroupInput,
    ): Promise<Translated<ProductOptionGroup>> {
        // Ensure the entity belongs to the active channel before updating.
        await this.connection.getEntityOrThrow(ctx, ProductOptionGroup, input.id, {
            channelId: ctx.channelId,
        });
        const group = await this.translatableSaver.update({
            ctx,
            input,
            entityType: ProductOptionGroup,
            translationType: ProductOptionGroupTranslation,
        });
        await this.customFieldRelationService.updateRelations(ctx, ProductOptionGroup, input, group);
        await this.eventBus.publish(new ProductOptionGroupEvent(ctx, group, 'updated', input));
        return assertFound(this.findOne(ctx, group.id));
    }

    /**
     * @description
     * Deletes a ProductOptionGroup. If the group is in use by any Products, the deletion
     * will fail unless `force` is set to `true`.
     */
    async delete(ctx: RequestContext, id: ID, force: boolean = false): Promise<DeletionResponse> {
        const optionGroup = await this.connection.getEntityOrThrow(ctx, ProductOptionGroup, id, {
            relationLoadStrategy: 'query',
            loadEagerRelations: false,
            relations: ['options', 'products'],
            channelId: ctx.channelId,
        });
        const productCount = optionGroup.products?.filter(p => p.deletedAt == null).length ?? 0;
        if (productCount > 0 && !force) {
            return {
                result: DeletionResult.NOT_DELETED,
                message: ctx.translate('message.product-option-group-used', {
                    code: optionGroup.code,
                    count: productCount,
                }),
            };
        }
        if (productCount > 0 && force) {
            // Detach from all products
            for (const product of optionGroup.products) {
                await this.connection
                    .getRepository(ctx, Product)
                    .createQueryBuilder()
                    .relation('optionGroups')
                    .of(product.id)
                    .remove(id);
            }
        }

        const deletedOptionGroup = new ProductOptionGroup(optionGroup);

        // Delete child options first
        const optionsToDelete = optionGroup.options?.filter(o => !o.deletedAt) ?? [];
        for (const option of optionsToDelete) {
            const { result, message } = await this.productOptionService.delete(ctx, option.id);
            if (result === DeletionResult.NOT_DELETED) {
                return { result, message };
            }
        }

        const hasOptionsWhichAreInUse = await this.groupOptionsAreInUse(ctx, optionGroup);
        if (hasOptionsWhichAreInUse > 0) {
            // soft delete
            optionGroup.deletedAt = new Date();
            await this.connection.getRepository(ctx, ProductOptionGroup).save(optionGroup, { reload: false });
        } else {
            // hard delete
            await this.connection.getRepository(ctx, ProductOptionGroup).remove(optionGroup);
        }
        await this.eventBus.publish(new ProductOptionGroupEvent(ctx, deletedOptionGroup, 'deleted', id));
        return {
            result: DeletionResult.DELETED,
        };
    }

    /**
     * @description
     * Deletes the ProductOptionGroup and any associated ProductOptions. If the ProductOptionGroup
     * is still referenced by a soft-deleted Product, then a soft-delete will be used to preserve
     * referential integrity. Otherwise a hard-delete will be performed.
     *
     * @deprecated Use {@link ProductOptionGroupService.delete} instead.
     */
    async deleteGroupAndOptionsFromProduct(ctx: RequestContext, id: ID, productId: ID) {
        const optionGroup = await this.connection.getEntityOrThrow(ctx, ProductOptionGroup, id, {
            relationLoadStrategy: 'query',
            loadEagerRelations: false,
            relations: ['options', 'products'],
        });
        const deletedOptionGroup = new ProductOptionGroup(optionGroup);
        const inUseByActiveProducts = await this.isInUseByOtherProducts(ctx, optionGroup, productId);
        if (inUseByActiveProducts > 0) {
            return {
                result: DeletionResult.NOT_DELETED,
                message: ctx.translate('message.product-option-group-used', {
                    code: optionGroup.code,
                    count: inUseByActiveProducts,
                }),
            };
        }

        const optionsToDelete = optionGroup.options && optionGroup.options.filter(group => !group.deletedAt);

        for (const option of optionsToDelete) {
            const { result, message } = await this.productOptionService.delete(ctx, option.id);
            if (result === DeletionResult.NOT_DELETED) {
                await this.connection.rollBackTransaction(ctx);
                return { result, message };
            }
        }
        const hasOptionsWhichAreInUse = await this.groupOptionsAreInUse(ctx, optionGroup);
        if (hasOptionsWhichAreInUse > 0) {
            // soft delete
            optionGroup.deletedAt = new Date();
            await this.connection.getRepository(ctx, ProductOptionGroup).save(optionGroup, { reload: false });
        } else {
            // hard delete
            const product = await this.connection.getRepository(ctx, Product).findOne({
                relationLoadStrategy: 'query',
                loadEagerRelations: false,
                where: { id: productId },
                relations: ['optionGroups'],
            });
            if (product) {
                product.optionGroups = product.optionGroups.filter(og => !idsAreEqual(og.id, id));
                await this.connection.getRepository(ctx, Product).save(product, { reload: false });
            }

            await this.connection.getRepository(ctx, ProductOptionGroup).remove(optionGroup);
        }
        await this.eventBus.publish(new ProductOptionGroupEvent(ctx, deletedOptionGroup, 'deleted', id));
        return {
            result: DeletionResult.DELETED,
        };
    }

    /**
     * @description
     * Assigns ProductOptionGroups to the specified Channel
     */
    async assignProductOptionGroupsToChannel(
        ctx: RequestContext,
        input: AssignProductOptionGroupsToChannelInput,
    ): Promise<Array<Translated<ProductOptionGroup>>> {
        const hasPermission = await this.roleService.userHasAnyPermissionsOnChannel(ctx, input.channelId, [
            Permission.UpdateCatalog,
            Permission.UpdateProduct,
        ]);
        if (!hasPermission) {
            throw new ForbiddenError();
        }
        const groupsToAssign = await this.connection
            .getRepository(ctx, ProductOptionGroup)
            .find({ where: { id: In(input.productOptionGroupIds) }, relations: ['options'] });
        const optionsToAssign = groupsToAssign.reduce(
            (options, group) => [...options, ...group.options],
            [] as ProductOption[],
        );

        await Promise.all([
            ...groupsToAssign.map(group =>
                this.channelService.assignToChannels(ctx, ProductOptionGroup, group.id, [input.channelId]),
            ),
            ...optionsToAssign.map(option =>
                this.channelService.assignToChannels(ctx, ProductOption, option.id, [input.channelId]),
            ),
        ]);
        return this.connection
            .findByIdsInChannel(
                ctx,
                ProductOptionGroup,
                groupsToAssign.map(g => g.id),
                ctx.channelId,
                {},
            )
            .then(groups => groups.map(group => this.translator.translate(group, ctx, ['options'])));
    }

    /**
     * @description
     * Removes ProductOptionGroups from the specified Channel
     */
    async removeProductOptionGroupsFromChannel(
        ctx: RequestContext,
        input: RemoveProductOptionGroupsFromChannelInput,
    ): Promise<
        Array<ErrorResultUnion<RemoveProductOptionGroupFromChannelResult, Translated<ProductOptionGroup>>>
    > {
        const hasPermission = await this.roleService.userHasAnyPermissionsOnChannel(ctx, input.channelId, [
            Permission.DeleteCatalog,
            Permission.DeleteProduct,
        ]);
        if (!hasPermission) {
            throw new ForbiddenError();
        }
        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        if (idsAreEqual(input.channelId, defaultChannel.id)) {
            throw new UserInputError('error.items-cannot-be-removed-from-default-channel');
        }
        const groupsToRemove = await this.connection
            .getRepository(ctx, ProductOptionGroup)
            .find({ where: { id: In(input.productOptionGroupIds) }, relations: ['options'] });

        const results: Array<
            ErrorResultUnion<RemoveProductOptionGroupFromChannelResult, Translated<ProductOptionGroup>>
        > = [];

        for (const group of groupsToRemove) {
            // Check if this group is in use by products in the target channel
            const productCount = await this.connection
                .getRepository(ctx, Product)
                .createQueryBuilder('product')
                .innerJoin('product.optionGroups', 'optionGroup', 'optionGroup.id = :groupId', {
                    groupId: group.id,
                })
                .innerJoin('product.channels', 'channel', 'channel.id = :channelId', {
                    channelId: input.channelId,
                })
                .where('product.deletedAt IS NULL')
                .getCount();

            const variantCount = await this.connection
                .getRepository(ctx, ProductVariant)
                .createQueryBuilder('variant')
                .leftJoin('variant.options', 'option')
                .innerJoin('variant.channels', 'channel', 'channel.id = :channelId', {
                    channelId: input.channelId,
                })
                .where('option.groupId = :groupId', { groupId: group.id })
                .andWhere('variant.deletedAt IS NULL')
                .getCount();

            const isInUse = !!(productCount || variantCount);

            if (!isInUse || input.force) {
                await this.channelService.removeFromChannels(ctx, ProductOptionGroup, group.id, [
                    input.channelId,
                ]);
                await Promise.all(
                    group.options.map(option =>
                        this.channelService.removeFromChannels(ctx, ProductOption, option.id, [
                            input.channelId,
                        ]),
                    ),
                );
                const result = await this.findOne(ctx, group.id);
                if (result) {
                    results.push(result);
                }
            } else {
                results.push(
                    new ProductOptionGroupInUseError({
                        optionGroupCode: group.code,
                        productCount,
                        variantCount,
                    }),
                );
            }
        }

        return results;
    }

    private async isInUseByOtherProducts(
        ctx: RequestContext,
        productOptionGroup: ProductOptionGroup,
        targetProductId: ID,
    ): Promise<number> {
        return this.connection
            .getRepository(ctx, Product)
            .createQueryBuilder('product')
            .leftJoin('product.optionGroups', 'optionGroup')
            .where('product.deletedAt IS NULL')
            .andWhere('optionGroup.id = :id', { id: productOptionGroup.id })
            .andWhere('product.id != :productId', { productId: targetProductId })
            .getCount();
    }

    private async groupOptionsAreInUse(ctx: RequestContext, productOptionGroup: ProductOptionGroup) {
        return this.connection
            .getRepository(ctx, ProductVariant)
            .createQueryBuilder('variant')
            .leftJoin('variant.options', 'option')
            .where('option.groupId = :groupId', { groupId: productOptionGroup.id })
            .getCount();
    }
}
