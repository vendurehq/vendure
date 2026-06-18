import type { Meta, StoryObj } from '@storybook/react-vite';
import { useForm } from 'react-hook-form';
import { withDescription } from '../../../.storybook/with-description.js';
import { DateTimeInput } from './datetime-input.js';

const meta = {
    title: 'Form Inputs/DateTimeInput',
    component: DateTimeInput,
    ...withDescription(import.meta.url, './datetime-input.js'),
    parameters: {
        layout: 'centered',
    },
    tags: ['autodocs'],
    argTypes: {
        value: {
            control: 'text',
            description: 'ISO 8601 datetime string',
        },
    },
} satisfies Meta<typeof DateTimeInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
    args: {
        value: new Date('2024-06-15T14:30:00').toISOString(),
    },
    render: args => {
        const { register } = useForm();
        const field = register('playground');
        return (
            <div className="w-[400px]">
                <DateTimeInput {...field} {...args} />
            </div>
        );
    },
};

export const FutureDate: Story = {
    render: () => {
        const { register } = useForm();
        const field = register('future');
        return (
            <div className="w-[400px]">
                <DateTimeInput {...field} />
            </div>
        );
    },
};

export const ClearableValue: Story = {
    render: () => {
        const { register } = useForm();
        const field = register('clearable');
        return (
            <div className="w-[400px]">
                <DateTimeInput {...field} />
            </div>
        );
    },
};
