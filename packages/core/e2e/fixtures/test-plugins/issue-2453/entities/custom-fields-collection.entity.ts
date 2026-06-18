import type { CustomFieldConfig } from '@vendure/core';
import { LanguageCode } from '@vendure/core';

import { Campaign } from './campaign.entity.js';

/**
 * `Collection` basic custom fields for `campaign`
 */
export const collectionCustomFields: CustomFieldConfig[] = [
    {
        type: 'relation',
        name: 'campaign',
        nullable: true,
        entity: Campaign,
        eager: true,
        // 当shop-api必须定义schema `Campaign` type,申明, 因为public=true
        public: true,
        graphQLType: 'Campaign',
        label: [
            {
                languageCode: LanguageCode.en,
                value: 'Campaign',
            },
        ],
        description: [
            {
                languageCode: LanguageCode.en,
                value: 'Campaign of this collection page',
            },
        ],
    },
    {
        name: 'invisible',
        type: 'boolean',
        public: true,
        nullable: true,
        defaultValue: false,
        label: [
            {
                languageCode: LanguageCode.en,
                value: 'Invisible',
            },
        ],
        description: [
            {
                languageCode: LanguageCode.en,
                value: 'This flag indicates if current collection is visible or inVisible, against `public`',
            },
        ],
    },
];
