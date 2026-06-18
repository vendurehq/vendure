import { pick } from '@vendure/common/lib/pick';

import * as Codegen from '../../common/generated-types';
import {
    CREATE_PROMOTION,
    DELETE_PROMOTION,
    DELETE_PROMOTIONS,
    GET_ADJUSTMENT_OPERATIONS,
    UPDATE_PROMOTION,
} from '../definitions/promotion-definitions';

import { BaseDataService } from './base-data.service';

export class PromotionDataService {
    constructor(private baseDataService: BaseDataService) {}

    getPromotionActionsAndConditions() {
        return this.baseDataService.query<Codegen.GetAdjustmentOperationsQuery>(GET_ADJUSTMENT_OPERATIONS);
    }

    createPromotion(input: Codegen.CreatePromotionInput) {
        return this.baseDataService.mutate<
            Codegen.CreatePromotionMutation,
            Codegen.CreatePromotionMutationVariables
        >(CREATE_PROMOTION, {
            input: pick(input, [
                'conditions',
                'actions',
                'couponCode',
                'startsAt',
                'endsAt',
                'perCustomerUsageLimit',
                'usageLimit',
                'enabled',
                'translations',
                'customFields',
            ]),
        });
    }

    updatePromotion(input: Codegen.UpdatePromotionInput) {
        return this.baseDataService.mutate<
            Codegen.UpdatePromotionMutation,
            Codegen.UpdatePromotionMutationVariables
        >(UPDATE_PROMOTION, {
            input: pick(input, [
                'id',
                'conditions',
                'actions',
                'couponCode',
                'startsAt',
                'endsAt',
                'perCustomerUsageLimit',
                'usageLimit',
                'enabled',
                'translations',
                'customFields',
            ]),
        });
    }

    deletePromotion(id: string) {
        return this.baseDataService.mutate<
            Codegen.DeletePromotionMutation,
            Codegen.DeletePromotionMutationVariables
        >(DELETE_PROMOTION, { id });
    }

    deletePromotions(ids: string[]) {
        return this.baseDataService.mutate<
            Codegen.DeletePromotionsMutation,
            Codegen.DeletePromotionsMutationVariables
        >(DELETE_PROMOTIONS, { ids });
    }
}
