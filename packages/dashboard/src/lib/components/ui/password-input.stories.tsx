import type { Meta, StoryObj } from '@storybook/react-vite';
import { PasswordInput } from './password-input.js';

const meta = {
    title: 'UI/Password Input',
    component: PasswordInput,
    parameters: {
        layout: 'centered',
    },
    tags: ['autodocs'],
    argTypes: {
        placeholder: {
            control: 'text',
            description: 'Placeholder text',
        },
        disabled: {
            control: 'boolean',
            description: 'Whether the input is disabled',
        },
    },
} satisfies Meta<typeof PasswordInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
    args: {
        placeholder: 'Enter password...',
        disabled: false,
    },
    render: args => <PasswordInput {...args} className="w-[300px]" />,
};
