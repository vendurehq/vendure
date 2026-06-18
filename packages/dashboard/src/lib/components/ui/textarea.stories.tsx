import type { Meta, StoryObj } from '@storybook/react-vite';
import { Textarea } from './textarea.js';

const meta = {
    title: 'UI/Textarea',
    component: Textarea,
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
            description: 'Whether the textarea is disabled',
        },
    },
} satisfies Meta<typeof Textarea>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
    args: {
        placeholder: 'Type your message here...',
        disabled: false,
    },
    render: args => <Textarea {...args} className="w-[400px]" />,
};
