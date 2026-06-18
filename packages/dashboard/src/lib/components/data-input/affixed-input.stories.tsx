import type { Meta, StoryObj } from '@storybook/react-vite';
import { Mail } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { withDescription } from '../../../.storybook/with-description.js';
import { AffixedInput } from './affixed-input.js';

const meta = {
    title: 'Form Inputs/AffixedInput',
    component: AffixedInput,
    ...withDescription(import.meta.url, './affixed-input.js'),
    parameters: {
        layout: 'centered',
    },
    tags: ['autodocs'],
    argTypes: {
        prefix: {
            control: 'text',
            description: 'Content to display before the input',
        },
        suffix: {
            control: 'text',
            description: 'Content to display after the input',
        },
        type: {
            control: 'select',
            options: ['text', 'number', 'email', 'url', 'tel'],
            description: 'Input type',
        },
        placeholder: {
            control: 'text',
            description: 'Placeholder text',
        },
        disabled: {
            control: 'boolean',
            description: 'Whether the input is disabled',
        },
        value: {
            control: 'text',
            description: 'Input value',
        },
    },
} satisfies Meta<typeof AffixedInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
    args: {
        prefix: '$',
        suffix: 'USD',
        value: '100.00',
        type: 'text',
        placeholder: 'Enter amount',
        disabled: false,
    },
    render: args => {
        const { register } = useForm();
        const field = register('amount');
        return <AffixedInput {...field} {...args} />;
    },
};

export const WithIconPrefix: Story = {
    render: () => {
        const { register } = useForm();
        const field = register('email');
        return <AffixedInput {...field} prefix={<Mail className="w-4 h-4" />} placeholder="Enter email" />;
    },
};

export const WithSuffix: Story = {
    render: () => {
        const { register } = useForm();
        const field = register('percentage');
        return <AffixedInput {...field} type="number" suffix="%" placeholder="Enter percentage" />;
    },
};

export const Disabled: Story = {
    render: () => {
        const { register } = useForm();
        const field = register('website');
        return <AffixedInput {...field} prefix="https://" suffix=".com" disabled />;
    },
};

export const NumberWithSteps: Story = {
    render: () => {
        const { register } = useForm();
        const field = register('weight');
        return <AffixedInput {...field} type="number" suffix="kg" step="0.1" min="0" max="100" />;
    },
};
