import { Injectable } from '@nestjs/common';
import {
    CreateSellerInput,
    DeletionResponse,
    DeletionResult,
    UpdateSellerInput,
} from '@vendure/common/lib/generated-types';
import { ID, PaginatedList } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../api/common/request-context';
import { Instrument } from '../../common/instrument-decorator';
import { ListQueryOptions } from '../../common/types/common-types';
import { assertFound } from '../../common/utils';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { Seller } from '../../entity/seller/seller.entity';
import { EventBus, SellerEvent } from '../../event-bus/index';
import { CustomFieldRelationService } from '../helpers/custom-field-relation/custom-field-relation.service';
import { ListQueryBuilder } from '../helpers/list-query-builder/list-query-builder';
import { patchEntity } from '../helpers/utils/patch-entity';
/**
 * @description
 * Contains methods relating to {@link Seller} entities.
 *
 * @docsCategory services
 */
@Injectable()
@Instrument()
export class SellerService {
    constructor(
        private connection: TransactionalConnection,
        private listQueryBuilder: ListQueryBuilder,
        private eventBus: EventBus,
        private customFieldRelationService: CustomFieldRelationService,
    ) {}

    async initSellers() {
        await this.ensureDefaultSellerExists();
    }

    findAll(ctx: RequestContext, options?: ListQueryOptions<Seller>): Promise<PaginatedList<Seller>> {
        return this.listQueryBuilder
            .build(Seller, options, { ctx })
            .getManyAndCount()
            .then(([items, totalItems]) => ({
                items,
                totalItems,
            }));
    }

    findOne(ctx: RequestContext, sellerId: ID): Promise<Seller | undefined> {
        return this.connection
            .getRepository(ctx, Seller)
            .findOne({ where: { id: sellerId } })
            .then(result => result ?? undefined);
    }

    async create(ctx: RequestContext, input: CreateSellerInput) {
        const seller = await this.connection.getRepository(ctx, Seller).save(new Seller(input));
        const sellerWithRelations = await this.customFieldRelationService.updateRelations(
            ctx,
            Seller,
            input,
            seller,
        );
        await this.eventBus.publish(new SellerEvent(ctx, sellerWithRelations, 'created', input));
        return assertFound(this.findOne(ctx, seller.id));
    }

    async update(ctx: RequestContext, input: UpdateSellerInput) {
        const seller = await this.connection.getEntityOrThrow(ctx, Seller, input.id);
        const updatedSeller = patchEntity(seller, input);
        await this.connection.getRepository(ctx, Seller).save(updatedSeller);
        const sellerWithRelations = await this.customFieldRelationService.updateRelations(
            ctx,
            Seller,
            input,
            seller,
        );
        await this.eventBus.publish(new SellerEvent(ctx, sellerWithRelations, 'updated', input));
        return seller;
    }

    async delete(ctx: RequestContext, id: ID): Promise<DeletionResponse> {
        const seller = await this.connection.getEntityOrThrow(ctx, Seller, id);
        await this.connection.getRepository(ctx, Seller).remove(seller);
        const deletedSeller = new Seller(seller);
        await this.eventBus.publish(new SellerEvent(ctx, deletedSeller, 'deleted', id));
        return {
            result: DeletionResult.DELETED,
        };
    }

    private async ensureDefaultSellerExists() {
        const sellers = await this.connection.rawConnection.getRepository(Seller).find();
        if (sellers.length === 0) {
            await this.connection.rawConnection.getRepository(Seller).save(
                new Seller({
                    name: 'Default Seller',
                }),
            );
        }
    }
}
