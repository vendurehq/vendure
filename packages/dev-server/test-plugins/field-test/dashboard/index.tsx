import { defineDashboardExtension } from '@vendure/dashboard';

import {
    ColorPickerComponent,
    EmailInputComponent,
    MarkdownEditorComponent,
    MultiCurrencyInputComponent,
    SlugInputComponent,
    TagsInputComponent,
} from './form-components';

defineDashboardExtension({
    customFormComponents: {
        customFields: [
            {
                id: 'test-input',
                component: props => {
                    return (
                        <input
                            placeholder="custom input"
                            value={props.value || ''}
                            onChange={e => props.onChange(e.target.value)}
                            className="border rounded-full"
                        />
                    );
                },
            },
            {
                id: 'color-picker',
                component: ColorPickerComponent,
            },
            {
                id: 'custom-email',
                component: EmailInputComponent,
            },
            {
                id: 'multi-currency-input',
                component: MultiCurrencyInputComponent,
            },
            {
                id: 'tags-input',
                component: TagsInputComponent,
            },
        ],
    },
    detailForms: [
        {
            pageId: 'product-detail',
            inputs: [
                {
                    blockId: 'main-form',
                    field: 'slug',
                    component: SlugInputComponent,
                },
                {
                    blockId: 'main-form',
                    field: 'description',
                    component: MarkdownEditorComponent,
                },
            ],
        },
        {
            pageId: 'customer-detail',
            inputs: [
                {
                    blockId: 'main-form',
                    field: 'emailAddress',
                    component: EmailInputComponent,
                },
            ],
        },
    ],
});
