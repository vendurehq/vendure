import {
    CreatePromotionInput,
    LanguageCode,
    Permission,
    PromotionTranslationInput,
} from '@vendure/common/lib/generated-types';

import { isGraphQlErrorResult } from '../../../common/error/error-result';
import { Injector } from '../../../common/injector';
import { TransactionalConnection } from '../../../connection/transactional-connection';
import { Promotion } from '../../../entity/promotion/promotion.entity';
import { PromotionService } from '../../../service/services/promotion.service';
import { EntityDuplicator } from '../entity-duplicator';

let connection: TransactionalConnection;
let promotionService: PromotionService;

/**
 * @description
 * Duplicates a Promotion
 */
export const promotionDuplicator = new EntityDuplicator({
    code: 'promotion-duplicator',
    description: [
        {
            languageCode: LanguageCode.en,
            value: 'Default duplicator for Promotions',
        },
    ],
    requiresPermission: [Permission.CreatePromotion],
    forEntities: ['Promotion'],
    args: {},
    init(injector: Injector) {
        connection = injector.get(TransactionalConnection);
        promotionService = injector.get(PromotionService);
    },
    async duplicate({ ctx, id }) {
        const promotion = await connection.getEntityOrThrow(ctx, Promotion, id);
        const translations: PromotionTranslationInput[] = promotion.translations.map(translation => {
            return {
                name: translation.name + ' (copy)',
                description: translation.description,
                languageCode: translation.languageCode,
                customFields: translation.customFields,
            };
        });
        const promotionInput: CreatePromotionInput = {
            couponCode: promotion.couponCode,
            startsAt: promotion.startsAt,
            endsAt: promotion.endsAt,
            perCustomerUsageLimit: promotion.perCustomerUsageLimit,
            usageLimit: promotion.usageLimit,
            conditions: promotion.conditions.map(condition => ({
                code: condition.code,
                arguments: condition.args,
            })),
            actions: promotion.actions.map(action => ({
                code: action.code,
                arguments: action.args,
            })),
            enabled: false,
            translations,
            customFields: promotion.customFields,
        };

        const duplicatedPromotion = await promotionService.createPromotion(ctx, promotionInput);
        if (isGraphQlErrorResult(duplicatedPromotion)) {
            throw new Error(duplicatedPromotion.message);
        }
        return duplicatedPromotion;
    },
});
