import { Injectable } from '@nestjs/common';
import { DeletionResponse, DeletionResult } from '@vendure/common/lib/generated-types';
import type { ID, ListQueryOptions, PaginatedList, Translated } from '@vendure/core';
import {
    assertFound,
    CollectionService,
    LanguageCode,
    ListQueryBuilder,
    RequestContext,
    TransactionalConnection,
    TranslatableSaver,
    translateDeep,
} from '@vendure/core';
import { In } from 'typeorm';

import { CampaignTranslation } from '../entities/campaign-translation.entity';
import { Campaign } from '../entities/campaign.entity';

import { defaultCampaignData } from './default-campaigns/index';

@Injectable()
export class CampaignService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly listQueryBuilder: ListQueryBuilder,
        private readonly collectionService: CollectionService,
        private readonly translatableSaver: TranslatableSaver,
    ) {}

    async initCampaigns() {
        const item = await this.makeSureDefaultCampaigns();
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        await this.makeSureDefaultCollections(item!);
    }

    findAll(
        ctx: RequestContext,
        options?: ListQueryOptions<Campaign>,
    ): Promise<PaginatedList<Translated<Campaign>>> {
        return this.listQueryBuilder
            .build(Campaign, options, { relations: ['promotion'], ctx })
            .getManyAndCount()
            .then(([campaignItems, totalItems]) => {
                const items = campaignItems.map(campaignItem =>
                    translateDeep(campaignItem, ctx.languageCode, ['promotion']),
                );
                return {
                    items,
                    totalItems,
                };
            });
    }

    findOne(ctx: RequestContext, id: ID): Promise<Translated<Campaign> | undefined | null> {
        return this.connection
            .getRepository(ctx, Campaign)
            .findOne({ where: { id }, relations: ['promotion'] })
            .then(campaignItem => {
                return campaignItem && translateDeep(campaignItem, ctx.languageCode, ['promotion']);
            });
    }

    findOneByCode(ctx: RequestContext, code: string): Promise<Translated<Campaign> | undefined | null> {
        return this.connection
            .getRepository(ctx, Campaign)
            .findOne({ where: { code }, relations: ['promotion'] })
            .then(campaignItem => {
                return campaignItem && translateDeep(campaignItem, ctx.languageCode, ['promotion']);
            });
    }

    async create(ctx: RequestContext, input: any): Promise<Translated<Campaign>> {
        const campaignItem = await this.translatableSaver.create({
            ctx,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            input,
            entityType: Campaign,
            translationType: CampaignTranslation,
        });
        return assertFound(this.findOne(ctx, campaignItem.id));
    }

    async update(ctx: RequestContext, input: any): Promise<Translated<Campaign>> {
        const campaignItem = await this.translatableSaver.update({
            ctx,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            input,
            entityType: Campaign,
            translationType: CampaignTranslation,
        });
        return assertFound(this.findOne(ctx, campaignItem.id));
    }

    async delete(ctx: RequestContext, ids: ID[]): Promise<DeletionResponse> {
        const items = await this.connection.getRepository(ctx, Campaign).find({
            where: {
                id: In(ids),
            },
        });
        await this.connection.getRepository(ctx, Campaign).delete(items.map(s => String(s.id)));

        return {
            result: DeletionResult.DELETED,
            message: '',
        };
    }

    private async makeSureDefaultCampaigns() {
        const ctx = RequestContext.empty();
        const { items } = await this.findAll(ctx);
        let item;
        for (const campaignItem of defaultCampaignData()) {
            const hasOne = items.find(s => s.code === campaignItem.code);
            if (!hasOne) {
                item = await this.create(ctx, campaignItem);
            } else {
                item = await this.update(ctx, {
                    ...campaignItem,
                    id: hasOne.id,
                });
            }
        }
        return item;
    }

    private async makeSureDefaultCollections(campaign: Translated<Campaign>) {
        const ctx = RequestContext.empty();
        const { totalItems } = await this.collectionService.findAll(ctx);
        if (totalItems > 0) {
            return;
        }
        const parent = await this.collectionService.create(ctx, {
            filters: [],
            translations: [
                {
                    name: 'parent collection',
                    slug: 'parent-collection',
                    description: 'parent collection description',
                    languageCode: LanguageCode.en,
                    customFields: {},
                },
            ],
        });
        await this.collectionService.create(ctx, {
            filters: [],
            parentId: parent?.id,
            customFields: {
                campaignId: campaign?.id,
            },
            translations: [
                {
                    name: 'children collection',
                    slug: 'children-collection',
                    description: 'children collection description',
                    languageCode: LanguageCode.en,
                    customFields: {},
                },
            ],
        });
    }
}
