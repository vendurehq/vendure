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
import { Translated } from '../../common/types/locale-types';
import { assertFound } from '../../common/utils';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { SellerTranslation } from '../../entity/seller/seller-translation.entity';
import { Seller } from '../../entity/seller/seller.entity';
import { EventBus, SellerEvent } from '../../event-bus/index';
import { CustomFieldRelationService } from '../helpers/custom-field-relation/custom-field-relation.service';
import { ListQueryBuilder } from '../helpers/list-query-builder/list-query-builder';
import { TranslatableSaver } from '../helpers/translatable-saver/translatable-saver';
import { TranslatorService } from '../helpers/translator/translator.service';

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
        private translatableSaver: TranslatableSaver,
        private translator: TranslatorService,
    ) {}

    async initSellers() {
        await this.ensureDefaultSellerExists();
    }

    findAll(
        ctx: RequestContext,
        options?: ListQueryOptions<Seller>,
    ): Promise<PaginatedList<Translated<Seller>>> {
        return this.listQueryBuilder
            .build(Seller, options, { ctx })
            .getManyAndCount()
            .then(([items, totalItems]) => ({
                items: items.map(seller => this.translator.translate(seller, ctx)),
                totalItems,
            }));
    }

    findOne(ctx: RequestContext, sellerId: ID): Promise<Translated<Seller> | undefined> {
        return this.connection
            .getRepository(ctx, Seller)
            .findOne({ where: { id: sellerId } })
            .then(seller => (seller ? this.translator.translate(seller, ctx) : undefined));
    }

    async create(ctx: RequestContext, input: CreateSellerInput): Promise<Translated<Seller>> {
        const seller = await this.translatableSaver.create({
            ctx,
            input,
            entityType: Seller,
            translationType: SellerTranslation,
        });
        const createdSeller = await assertFound(this.findOne(ctx, seller.id));
        await this.customFieldRelationService.updateRelations(ctx, Seller, input, createdSeller);
        await this.eventBus.publish(new SellerEvent(ctx, createdSeller, 'created', input));
        return createdSeller;
    }

    async update(ctx: RequestContext, input: UpdateSellerInput): Promise<Translated<Seller>> {
        await this.connection.getEntityOrThrow(ctx, Seller, input.id);
        const seller = await this.translatableSaver.update({
            ctx,
            input,
            entityType: Seller,
            translationType: SellerTranslation,
        });
        const updatedSeller = await assertFound(this.findOne(ctx, seller.id));
        await this.customFieldRelationService.updateRelations(ctx, Seller, input, updatedSeller);
        await this.eventBus.publish(new SellerEvent(ctx, updatedSeller, 'updated', input));
        return updatedSeller;
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
