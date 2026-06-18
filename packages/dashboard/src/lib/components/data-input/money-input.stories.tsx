import type { Meta, StoryObj } from '@storybook/react-vite';
import { useForm } from 'react-hook-form';
import { withDescription } from '../../../.storybook/with-description.js';
import { MoneyInput } from './money-input.js';

const meta = {
    title: 'Form Inputs/MoneyInput',
    component: MoneyInput,
    ...withDescription(import.meta.url, './money-input.js'),
    parameters: {
        layout: 'centered',
    },
    tags: ['autodocs'],
    argTypes: {
        value: {
            control: 'number',
            description: 'The current value in minor units (e.g., cents)',
        },
        currency: {
            control: 'select',
            options: ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD'],
            description: 'The currency code',
        },
    },
} satisfies Meta<typeof MoneyInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
    args: {
        value: 9999,
        currency: 'USD',
    },
    render: args => {
        const { register } = useForm();
        const field = register('playground');
        return (
            <div className="w-[300px]">
                <MoneyInput {...field} {...args} />
            </div>
        );
    },
};

export const DifferentCurrencies: Story = {
    args: {
        value: 9999,
    },
    render: (args: any) => {
        const { register } = useForm();
        return (
            <div className="w-[300px] space-y-4">
                <div className="space-y-2">
                    <label className="text-sm font-medium">USD</label>
                    <MoneyInput {...register('usd')} currency="USD" value={args.value} />
                </div>

                <div className="space-y-2">
                    <label className="text-sm font-medium">EUR</label>
                    <MoneyInput {...register('eur')} currency="EUR" value={args.value} />
                </div>

                <div className="space-y-2">
                    <label className="text-sm font-medium">GBP</label>
                    <MoneyInput {...register('gbp')} currency="GBP" value={args.value} />
                </div>

                <div className="space-y-2">
                    <label className="text-sm font-medium">JPY</label>
                    <MoneyInput {...register('jpy')} currency="JPY" value={args.value} />
                </div>
            </div>
        );
    },
};

export const LargeAmount: Story = {
    render: () => {
        const { register } = useForm();
        const field = register('large');
        return (
            <div className="w-[300px]">
                <MoneyInput {...field} currency="USD" value={123} />
            </div>
        );
    },
};
