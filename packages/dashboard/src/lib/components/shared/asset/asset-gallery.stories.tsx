import { AssetGallery } from '@/vdb/components/shared/asset/asset-gallery.js';
import { FullWidthPageBlock, Page, PageLayout } from '@/vdb/framework/layout-engine/page-layout.js';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { RouterContextProvider } from '@tanstack/react-router';
import { createDemoRoute } from '../../../../../.storybook/providers.js';
import { withDescription } from '../../../../../.storybook/with-description.js';

const meta = {
    title: 'Framework/AssetGallery',
    component: AssetGallery,
    ...withDescription(import.meta.url, './asset-gallery.js'),
    parameters: {
        layout: 'fullscreen',
    },
    tags: ['autodocs'],
    argTypes: {
        selectable: {
            control: 'boolean',
            description: 'Whether assets can be selected',
        },
        multiSelect: {
            control: 'select',
            options: ['auto', 'manual'],
            description: 'Multi-select mode',
        },
        pageSize: {
            control: 'number',
            description: 'Number of assets per page',
        },
        fixedHeight: {
            control: 'boolean',
            description: 'Whether the gallery has a fixed height',
        },
        showHeader: {
            control: 'boolean',
            description: 'Whether to show the header with search and filters',
        },
        displayBulkActions: {
            control: 'boolean',
            description: 'Whether to display bulk actions bar',
        },
    },
} satisfies Meta<typeof AssetGallery>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
    args: {
        selectable: true,
        multiSelect: 'manual',
        pageSize: 12,
        fixedHeight: false,
        showHeader: true,
        displayBulkActions: true,
    },
    render: args => {
        const { route, router } = createDemoRoute();
        return (
            <div className="p-6 h-screen">
                <RouterContextProvider router={router}>
                    <Page pageId="test-page">
                        <PageLayout>
                            <FullWidthPageBlock blockId="test-block">
                                <AssetGallery
                                    {...args}
                                    onSelect={assets => console.log('Selected:', assets)}
                                />
                            </FullWidthPageBlock>
                        </PageLayout>
                    </Page>
                </RouterContextProvider>
            </div>
        );
    },
};
