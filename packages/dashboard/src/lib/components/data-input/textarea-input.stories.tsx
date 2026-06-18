import type { Meta, StoryObj } from '@storybook/react-vite';
import { useForm } from 'react-hook-form';
import { withDescription } from '../../../.storybook/with-description.js';
import { TextareaInput } from './textarea-input.js';

const meta = {
    title: 'Form Inputs/TextareaInput',
    component: TextareaInput,
    ...withDescription(import.meta.url, './textarea-input.js'),
    parameters: {
        layout: 'centered',
    },
    tags: ['autodocs'],
    argTypes: {
        value: {
            control: 'text',
            description: 'The current value',
        },
        disabled: {
            control: 'boolean',
            description: 'Whether the textarea is disabled',
        },
    },
} satisfies Meta<typeof TextareaInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
    args: {
        value: 'Edit this text!\nMultiple lines supported.',
        disabled: false,
    },
    render: args => {
        const { register } = useForm();
        const field = register('playground');
        return (
            <div className="w-[500px]">
                <TextareaInput {...field} {...args} />
            </div>
        );
    },
};

export const LongText: Story = {
    render: () => {
        const { register } = useForm();
        const field = register('longText');
        return (
            <div className="w-[500px]">
                <TextareaInput {...field} />
            </div>
        );
    },
};
