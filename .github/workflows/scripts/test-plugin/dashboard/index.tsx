import { defineDashboardExtension } from '@vendure/dashboard';

defineDashboardExtension({
    // Let's add a simple test page to check things are working
    actionBarItems: [{
        pageId: 'product-list',
        component: () => <div data-testid="test-component">test component</div>
    }]
});