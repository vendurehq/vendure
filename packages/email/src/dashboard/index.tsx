import { defineDashboardExtension } from '@vendure/dashboard';

import { emailsRoute } from './emails-route';
import { OrderEmailsBlock } from './order-emails-block';

defineDashboardExtension({
    routes: [emailsRoute],
    pageBlocks: [
        {
            id: 'order-emails',
            title: /* i18n*/ 'Emails',
            component: OrderEmailsBlock,
            location: {
                pageId: 'order-detail',
                column: 'side',
                position: { blockId: 'customer', order: 'after' },
            },
        },
    ],
});
