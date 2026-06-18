import type { Meta, StoryObj } from '@storybook/react-vite';
import { Switch } from './switch.js';

const meta = {
    title: 'UI/Switch',
    component: Switch,
    parameters: {
        layout: 'centered',
    },
    tags: ['autodocs'],
    argTypes: {
        disabled: {
            control: 'boolean',
            description: 'Whether the switch is disabled',
        },
        checked: {
            control: 'boolean',
            description: 'Whether the switch is checked',
        },
    },
} satisfies Meta<typeof Switch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
    args: {
        checked: false,
        disabled: false,
    },
};
