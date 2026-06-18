import type { Meta, StoryObj } from '@storybook/react-vite';
import { Bold } from 'lucide-react';
import { Toggle } from './toggle.js';

const meta = {
    title: 'UI/Toggle',
    component: Toggle,
    parameters: {
        layout: 'centered',
    },
    tags: ['autodocs'],
    argTypes: {
        variant: {
            control: 'select',
            options: ['default', 'outline'],
            description: 'Toggle variant',
        },
        size: {
            control: 'select',
            options: ['default', 'sm', 'lg'],
            description: 'Toggle size',
        },
    },
} satisfies Meta<typeof Toggle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
    args: {
        variant: 'default',
        size: 'default',
    },
    render: args => (
        <Toggle {...args}>
            <Bold className="h-4 w-4" />
        </Toggle>
    ),
};
