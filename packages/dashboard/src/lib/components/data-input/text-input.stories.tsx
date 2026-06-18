import type { Meta, StoryObj } from '@storybook/react-vite';
import { useForm } from 'react-hook-form';
import { withDescription } from '../../../.storybook/with-description.js';
import { TextInput } from './text-input.js';

const meta = {
    title: 'Form Inputs/TextInput',
    component: TextInput,
    ...withDescription(import.meta.url, './text-input.js'),
    parameters: {
        layout: 'centered',
    },
    tags: ['autodocs'],
    argTypes: {
        value: {
            control: 'text',
            description: 'The current value',
        },
        placeholder: {
            control: 'text',
            description: 'Placeholder text',
        },
        disabled: {
            control: 'boolean',
            description: 'Whether the input is disabled',
        },
    },
} satisfies Meta<typeof TextInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
    args: {
        value: 'Edit me!',
        placeholder: 'Enter text',
        disabled: false,
    },
    render: args => {
        const { register } = useForm();
        const field = register('text');
        return <TextInput {...field} {...args} />;
    },
};

export const LongText: Story = {
    render: () => {
        const { register } = useForm();
        const field = register('longText');
        return <TextInput {...field} />;
    },
};
