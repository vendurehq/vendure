import type { Meta, StoryObj } from '@storybook/react-vite';
import { Checkbox } from './checkbox.js';

const meta = {
    title: 'UI/Checkbox',
    component: Checkbox,
    parameters: {
        layout: 'centered',
    },
    tags: ['autodocs'],
    argTypes: {
        disabled: {
            control: 'boolean',
            description: 'Whether the checkbox is disabled',
        },
        checked: {
            control: 'boolean',
            description: 'Whether the checkbox is checked',
        },
    },
} satisfies Meta<typeof Checkbox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
    args: {
        checked: false,
        disabled: false,
    },
};
