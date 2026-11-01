import { CustomFields, LanguageCode } from '@vendure/core';

/** 四期增长闭环：评价有礼与追评窗口的渠道级配置（存 Channel customFields，admin 可视可改）。 */
export const reviewChannelCustomFields: CustomFields = {
    Channel: [
        {
            name: 'reviewGiftCouponTemplateId',
            type: 'string',
            label: [{ languageCode: LanguageCode.zh_Hans, value: '评价有礼：奖励券模板 ID（空=不发券）' }],
            description: [
                { languageCode: LanguageCode.zh_Hans, value: '主评价审核通过后自动发放该优惠券模板；留空表示不启用发券奖励' },
            ],
        },
        {
            name: 'reviewGiftQualityCouponTemplateId',
            type: 'string',
            label: [{ languageCode: LanguageCode.zh_Hans, value: '评价有礼：礼包「质量」券模板 ID（空=用通用模板）' }],
            description: [
                { languageCode: LanguageCode.zh_Hans, value: '顾客写评价时选「质量」礼包，审核通过后发此模板；留空回落通用奖励券模板' },
            ],
        },
        {
            name: 'reviewGiftServiceCouponTemplateId',
            type: 'string',
            label: [{ languageCode: LanguageCode.zh_Hans, value: '评价有礼：礼包「服务」券模板 ID（空=用通用模板）' }],
            description: [
                { languageCode: LanguageCode.zh_Hans, value: '顾客写评价时选「服务」礼包，审核通过后发此模板；留空回落通用奖励券模板' },
            ],
        },
        {
            name: 'reviewGiftTimeCouponTemplateId',
            type: 'string',
            label: [{ languageCode: LanguageCode.zh_Hans, value: '评价有礼：礼包「时间」券模板 ID（空=用通用模板）' }],
            description: [
                { languageCode: LanguageCode.zh_Hans, value: '顾客写评价时选「时间」礼包，审核通过后发此模板；留空回落通用奖励券模板' },
            ],
        },
        {
            name: 'reviewGiftPoints',
            type: 'int',
            defaultValue: 0,
            label: [{ languageCode: LanguageCode.zh_Hans, value: '评价有礼：奖励积分（0=不发）' }],
        },
        {
            name: 'reviewFollowUpWindowDays',
            type: 'int',
            defaultValue: 7,
            label: [{ languageCode: LanguageCode.zh_Hans, value: '追评窗口（天，0=不允许追评）' }],
        },
    ],
};
