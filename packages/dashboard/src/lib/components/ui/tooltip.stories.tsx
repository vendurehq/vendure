import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './button.js';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip.js';

const meta = {
    title: 'UI/Tooltip',
    component: Tooltip,
    parameters: {
        layout: 'centered',
    },
    tags: ['autodocs'],
} satisfies Meta<typeof Tooltip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
    render: () => (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger render={<Button />}>Hover me</TooltipTrigger>
                <TooltipContent>
                    <p>This is a tooltip</p>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    ),
};
