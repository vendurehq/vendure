import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Button } from './button.js';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './collapsible.js';

const meta = {
    title: 'UI/Collapsible',
    component: Collapsible,
    parameters: {
        layout: 'centered',
    },
    tags: ['autodocs'],
} satisfies Meta<typeof Collapsible>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
    render: () => {
        const [isOpen, setIsOpen] = useState(false);
        return (
            <Collapsible open={isOpen} onOpenChange={setIsOpen} className="w-[350px] space-y-2">
                <div className="flex items-center justify-between space-x-4 px-4">
                    <h4 className="text-sm font-semibold">@peduarte starred 3 repositories</h4>
                    <CollapsibleTrigger render={<Button variant="ghost" size="sm" />}>
                        {isOpen ? 'Hide' : 'Show'}
                    </CollapsibleTrigger>
                </div>
                <div className="rounded-md border px-4 py-3 font-mono text-sm">@base-ui/react</div>
                <CollapsibleContent className="space-y-2">
                    <div className="rounded-md border px-4 py-3 font-mono text-sm">@vendure-io/ui</div>
                    <div className="rounded-md border px-4 py-3 font-mono text-sm">@vendure-io/design-tokens</div>
                </CollapsibleContent>
            </Collapsible>
        );
    },
};
