import { Button } from '@/vdb/components/ui/button.js';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { RouterContextProvider } from '@tanstack/react-router';
import { useState } from 'react';
import { createDemoRoute } from '../../../../../.storybook/providers.js';
import { withDescription } from '../../../../../.storybook/with-description.js';
import { AssetPickerDialog } from './asset-picker-dialog.js';

const meta = {
    title: 'Framework/AssetPickerDialog',
    component: AssetPickerDialog,
    ...withDescription(import.meta.url, './asset-picker-dialog.js'),
    parameters: {
        layout: 'centered',
    },
    tags: ['autodocs'],
    argTypes: {
        multiSelect: {
            control: 'boolean',
            description: 'Whether multiple assets can be selected',
        },
        title: {
            control: 'text',
            description: 'The title of the dialog',
        },
    },
} satisfies Meta<typeof AssetPickerDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
    args: {
        multiSelect: false,
        title: 'Select Assets',
    },
    render: args => {
        const [open, setOpen] = useState(false);
        const { route, router } = createDemoRoute();

        return (
            <RouterContextProvider router={router}>
                <div>
                    <Button onClick={() => setOpen(true)}>Open Asset Picker</Button>
                    <AssetPickerDialog
                        {...args}
                        open={open}
                        onClose={() => setOpen(false)}
                        onSelect={assets => {
                            console.log('Selected assets:', assets);
                            setOpen(false);
                        }}
                    />
                </div>
            </RouterContextProvider>
        );
    },
};
