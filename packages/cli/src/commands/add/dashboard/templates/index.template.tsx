import { Button, defineDashboardExtension, Page, PageBlock, PageLayout, PageTitle } from '@vendure/dashboard';
import { useState } from 'react';

defineDashboardExtension({
    routes: [
        // Here's a custom page so you can test that your Dashboard extensions are working.
        // You should be able to access this page via the "Catalog > Test Page" nav menu item.
        {
            path: '/test',
            loader: () => ({ breadcrumb: 'Test Page' }),
            navMenuItem: {
                id: 'test',
                title: 'Test Page',
                sectionId: 'catalog',
            },
            component: () => {
                const [count, setCount] = useState(0);
                return (
                    <Page pageId="test-page">
                        <PageTitle>Test Page</PageTitle>
                        <PageLayout>
                            <PageBlock column="main" blockId="counter">
                                <p>Congratulations, your Dashboard extension is working!</p>
                                <p className="text-muted-foreground mb-4">
                                    As is traditional, let's include a counter:
                                </p>
                                <Button variant="secondary" onClick={() => setCount(c => c + 1)}>
                                    Clicked {count} times
                                </Button>
                            </PageBlock>
                        </PageLayout>
                    </Page>
                );
            },
        },
    ],
    // The following extension points are only listed here
    // to give you an idea of all the ways that the Dashboard
    // can be extended. Feel free to delete any that you don't need.
    pageBlocks: [],
    navSections: [],
    actionBarItems: [],
    alerts: [],
    widgets: [],
    customFormComponents: {},
    dataTables: [],
    detailForms: [],
    login: {},
    historyEntries: [],
});
