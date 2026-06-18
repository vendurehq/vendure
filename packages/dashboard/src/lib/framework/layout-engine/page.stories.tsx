import { Button } from '@/vdb/components/ui/button.js';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { RouterContextProvider } from '@tanstack/react-router';
import { createDemoRoute } from '../../../../.storybook/providers.js';
import {
    FullWidthPageBlock,
    Page,
    PageActionBar,
    PageActionBarLeft,
    PageActionBarRight,
    PageBlock,
    PageLayout,
    PageTitle,
} from './page-layout.js';

const meta = {
    title: 'Layout/Page Layout',
    component: Page,
    parameters: {
        layout: 'fullscreen',
    },
    tags: ['autodocs'],
} satisfies Meta<typeof Page>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
    render: () => {
        const { route, router } = createDemoRoute();
        return (
            <RouterContextProvider router={router}>
                <Page pageId="test-page">
                    <PageTitle>Test Page</PageTitle>
                    <PageLayout>
                        <PageBlock column="main" blockId="main-stuff">
                            This will display in the main area
                        </PageBlock>
                        <PageBlock column="side" blockId="side-stuff">
                            This will display in the side area
                        </PageBlock>
                    </PageLayout>
                </Page>
            </RouterContextProvider>
        );
    },
};

export const WithActionBar: Story = {
    render: () => {
        const { route, router } = createDemoRoute();
        return (
            <RouterContextProvider router={router}>
                <Page pageId="product-detail">
                    <PageTitle>Product Details</PageTitle>
                    <PageActionBar>
                        <PageActionBarLeft>
                            <Button variant="outline">Cancel</Button>
                        </PageActionBarLeft>
                        <PageActionBarRight>
                            <Button>Save</Button>
                        </PageActionBarRight>
                    </PageActionBar>
                    <PageLayout>
                        <PageBlock column="main" blockId="product-info" title="Product Information">
                            <div className="space-y-4">
                                <div>
                                    <label className="text-sm font-medium">Name</label>
                                    <input
                                        type="text"
                                        className="w-full border rounded px-3 py-2 mt-1"
                                        defaultValue="Wireless Headphones"
                                    />
                                </div>
                                <div>
                                    <label className="text-sm font-medium">Description</label>
                                    <textarea
                                        className="w-full border rounded px-3 py-2 mt-1"
                                        rows={4}
                                        defaultValue="High-quality wireless headphones with active noise cancellation."
                                    />
                                </div>
                            </div>
                        </PageBlock>
                        <PageBlock column="side" blockId="product-meta" title="Metadata">
                            <div className="space-y-3">
                                <div>
                                    <div className="text-sm font-medium">Status</div>
                                    <div className="text-sm text-muted-foreground">Active</div>
                                </div>
                                <div>
                                    <div className="text-sm font-medium">SKU</div>
                                    <div className="text-sm text-muted-foreground">WH-001</div>
                                </div>
                                <div>
                                    <div className="text-sm font-medium">Price</div>
                                    <div className="text-sm text-muted-foreground">$299.00</div>
                                </div>
                            </div>
                        </PageBlock>
                    </PageLayout>
                </Page>
            </RouterContextProvider>
        );
    },
};

export const MultipleBlocks: Story = {
    render: () => {
        const { route, router } = createDemoRoute();
        return (
            <RouterContextProvider router={router}>
                <Page pageId="complex-page">
                    <PageTitle>Complex Page Layout</PageTitle>
                    <PageLayout>
                        <PageBlock
                            column="main"
                            blockId="block-1"
                            title="Main Block 1"
                            description="This is the first main block"
                        >
                            <p>Content for the first main block goes here.</p>
                        </PageBlock>
                        <PageBlock
                            column="main"
                            blockId="block-2"
                            title="Main Block 2"
                            description="This is the second main block"
                        >
                            <p>Content for the second main block goes here.</p>
                        </PageBlock>
                        <PageBlock column="side" blockId="side-1" title="Sidebar Block 1">
                            <p>First sidebar block content.</p>
                        </PageBlock>
                        <PageBlock column="side" blockId="side-2" title="Sidebar Block 2">
                            <p>Second sidebar block content.</p>
                        </PageBlock>
                        <PageBlock column="side" blockId="side-3" title="Sidebar Block 3">
                            <p>Third sidebar block content.</p>
                        </PageBlock>
                    </PageLayout>
                </Page>
            </RouterContextProvider>
        );
    },
};

export const WithFullWidthBlock: Story = {
    render: () => {
        const { route, router } = createDemoRoute();
        return (
            <RouterContextProvider router={router}>
                <Page pageId="dashboard-overview">
                    <PageTitle>Dashboard Overview</PageTitle>
                    <PageLayout>
                        <FullWidthPageBlock blockId="stats">
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-6 bg-muted/50 rounded-lg">
                                <div className="text-center">
                                    <div className="text-3xl font-bold">1,234</div>
                                    <div className="text-sm text-muted-foreground">Total Orders</div>
                                </div>
                                <div className="text-center">
                                    <div className="text-3xl font-bold">$45,678</div>
                                    <div className="text-sm text-muted-foreground">Revenue</div>
                                </div>
                                <div className="text-center">
                                    <div className="text-3xl font-bold">567</div>
                                    <div className="text-sm text-muted-foreground">Products</div>
                                </div>
                                <div className="text-center">
                                    <div className="text-3xl font-bold">890</div>
                                    <div className="text-sm text-muted-foreground">Customers</div>
                                </div>
                            </div>
                        </FullWidthPageBlock>
                        <PageBlock column="main" blockId="recent-orders" title="Recent Orders">
                            <div className="space-y-2">
                                {[1, 2, 3].map(i => (
                                    <div key={i} className="flex justify-between py-2 border-b">
                                        <span>Order #{1000 + i}</span>
                                        <span className="text-muted-foreground">$99.00</span>
                                    </div>
                                ))}
                            </div>
                        </PageBlock>
                        <PageBlock column="side" blockId="quick-stats" title="Quick Stats">
                            <div className="space-y-3">
                                <div>
                                    <div className="text-sm font-medium">Pending Orders</div>
                                    <div className="text-2xl font-bold">12</div>
                                </div>
                                <div>
                                    <div className="text-sm font-medium">Low Stock Items</div>
                                    <div className="text-2xl font-bold">5</div>
                                </div>
                            </div>
                        </PageBlock>
                    </PageLayout>
                </Page>
            </RouterContextProvider>
        );
    },
};

export const MinimalPage: Story = {
    render: () => {
        const { route, router } = createDemoRoute();
        return (
            <RouterContextProvider router={router}>
                <Page pageId="simple-page">
                    <PageTitle>Simple Page</PageTitle>
                    <PageLayout>
                        <PageBlock column="main" blockId="content">
                            <p>This is a minimal page with just a title and one content block.</p>
                        </PageBlock>
                    </PageLayout>
                </Page>
            </RouterContextProvider>
        );
    },
};

export const WithBlockDescriptions: Story = {
    render: () => {
        const { route, router } = createDemoRoute();
        return (
            <RouterContextProvider router={router}>
                <Page pageId="settings-page">
                    <PageTitle>Settings</PageTitle>
                    <PageLayout>
                        <PageBlock
                            column="main"
                            blockId="general"
                            title="General Settings"
                            description="Configure general application settings and preferences"
                        >
                            <div className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <label className="text-sm font-medium">Enable notifications</label>
                                    <input type="checkbox" defaultChecked />
                                </div>
                                <div className="flex items-center justify-between">
                                    <label className="text-sm font-medium">Dark mode</label>
                                    <input type="checkbox" />
                                </div>
                            </div>
                        </PageBlock>
                        <PageBlock
                            column="main"
                            blockId="advanced"
                            title="Advanced Settings"
                            description="Advanced configuration options for power users"
                        >
                            <div className="space-y-4">
                                <div>
                                    <label className="text-sm font-medium">API Key</label>
                                    <input
                                        type="text"
                                        className="w-full border rounded px-3 py-2 mt-1"
                                        defaultValue="sk_test_..."
                                    />
                                </div>
                            </div>
                        </PageBlock>
                        <PageBlock column="side" blockId="help" title="Help" description="Need assistance?">
                            <Button variant="outline" className="w-full">
                                View Documentation
                            </Button>
                        </PageBlock>
                    </PageLayout>
                </Page>
            </RouterContextProvider>
        );
    },
};
