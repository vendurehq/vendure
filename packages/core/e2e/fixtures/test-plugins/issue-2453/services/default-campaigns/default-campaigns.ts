import { LanguageCode } from '@vendure/common/lib/generated-types';

export const defaultCampaigns = () =>
    [
        {
            code: 'discount',
            campaignType: 'DirectDiscount',
            needClaimCoupon: false,
            enabled: true,
            translations: [
                {
                    languageCode: LanguageCode.en,
                    name: 'Clearance Up to 70% Off frames',
                    shortDesc: 'Clearance Up to 70% Off frames',
                },
                {
                    languageCode: LanguageCode.de,
                    name: 'Clearance Up to 70% Off frames of de',
                    shortDesc: 'Clearance Up to 70% Off frames of de',
                },
            ],
        },
    ] as any[];
