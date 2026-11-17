import { Injectable } from '@nestjs/common';
import {
    CreateSellerInput,
    DeletionResponse,
    DeletionResult,
    SellerTranslationInput,
    UpdateSellerInput,
} from '@vendure/common/lib/generated-types';
import { ID, PaginatedList } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../api/common/request-context';
import { Instrument } from '../../common/instrument-decorator';
import { ListQueryOptions } from '../../common/types/common-types';
import { Translated, Translation } from '../../common/types/locale-types';
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
            input: { ...input, translations: this.withoutBlankTranslations(input.translations) },
            entityType: Seller,
            translationType: SellerTranslation,
        });
        const createdSeller = await assertFound(this.findOne(ctx, seller.id));
        await this.customFieldRelationService.updateRelations(ctx, Seller, input, createdSeller);
        await this.eventBus.publish(new SellerEvent(ctx, createdSeller, 'created', input));
        return createdSeller;
    }

    async update(ctx: RequestContext, input: UpdateSellerInput): Promise<Translated<Seller>> {
        const existing = await this.connection.getEntityOrThrow(ctx, Seller, input.id);
        const seller = await this.translatableSaver.update({
            ctx,
            input: {
                ...input,
                translations: this.withoutBlankTranslations(input.translations, existing.translations),
            },
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

    // Needed only because a SellerTranslation holds nothing but custom field values for now. A row with
    // none of them set says nothing, and both admin UIs submit such rows anyway. A language which
    // already has a row is kept even when every value is blank, because clearing them is how a
    // localized value gets removed. Matching on languageCode rather than on the input id is what
    // TranslationDiffer itself matches on, so a client which omits the id still clears the value.
    private withoutBlankTranslations(
        translations: SellerTranslationInput[] | null | undefined,
        existing: Array<Translation<Seller>> = [],
    ) {
        const isSet = (value: unknown) =>
            value != null && value !== '' && !(Array.isArray(value) && !value.length);
        return translations?.filter(
            t =>
                existing.some(e => e.languageCode === t.languageCode) ||
                Object.values(t.customFields ?? {}).some(isSet),
        );
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
