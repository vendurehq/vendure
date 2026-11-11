import { defineDashboardExtension } from '@vendure/dashboard';

import { emailDesignRoute } from './email-design-route';
import { emailsRoute } from './emails-route';
import { OrderEmailsBlock } from './order-emails-block';

defineDashboardExtension({
    routes: [emailsRoute, emailDesignRoute],
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
