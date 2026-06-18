import type { Meta, StoryObj } from '@storybook/react-vite';
import { RouterContextProvider } from '@tanstack/react-router';
import { createDemoRoute } from '../../../../.storybook/providers.js';
import { withDescription } from '../../../../.storybook/with-description.js';
import { DetailPageButton } from './detail-page-button.js';

const meta = {
    title: 'Framework/DetailPageButton',
    component: DetailPageButton,
    ...withDescription(import.meta.url, './detail-page-button.js'),
    parameters: {
        layout: 'centered',
    },
    tags: ['autodocs'],
    argTypes: {
        label: {
            control: 'text',
            description: 'The button label text',
        },
        disabled: {
            control: 'boolean',
            description: 'Whether the button is disabled',
        },
        id: {
            control: 'text',
            description: 'ID for relative navigation (e.g., "123")',
        },
        href: {
            control: 'text',
            description: 'Custom href for absolute navigation',
        },
    },
} satisfies Meta<typeof DetailPageButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
    args: {
        label: 'View Details',
        id: '123',
        disabled: false,
    },
    render: args => {
        const { route, router } = createDemoRoute();
        return (
            <RouterContextProvider router={router}>
                <DetailPageButton {...args} />
            </RouterContextProvider>
        );
    },
};
