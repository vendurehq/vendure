import type { Meta, StoryObj } from '@storybook/react-vite';
import { useForm } from 'react-hook-form';
import { withDescription } from '../../../.storybook/with-description.js';
import { PasswordFormInput } from './password-form-input.js';

const meta = {
    title: 'Form Inputs/PasswordFormInput',
    component: PasswordFormInput,
    ...withDescription(import.meta.url, './password-form-input.js'),
    parameters: {
        layout: 'centered',
    },
    tags: ['autodocs'],
    argTypes: {
        value: {
            control: 'text',
            description: 'The current password value',
        },
        disabled: {
            control: 'boolean',
            description: 'Whether the input is disabled',
        },
    },
} satisfies Meta<typeof PasswordFormInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
    args: {
        value: 'secret123',
        disabled: false,
    },
    render: args => {
        const { register } = useForm();
        const field = register('password');
        return (
            <div className="w-[300px]">
                <PasswordFormInput {...field} {...args} />
            </div>
        );
    },
};

export const ChangePassword: Story = {
    render: () => {
        const { register } = useForm();
        return (
            <div className="w-[300px] space-y-4">
                <div className="space-y-2">
                    <label className="text-sm font-medium">Current Password</label>
                    <PasswordFormInput {...register('currentPassword')} />
                </div>
                <div className="space-y-2">
                    <label className="text-sm font-medium">New Password</label>
                    <PasswordFormInput {...register('newPassword')} />
                </div>
                <div className="space-y-2">
                    <label className="text-sm font-medium">Confirm New Password</label>
                    <PasswordFormInput {...register('confirmPassword')} />
                </div>
            </div>
        );
    },
};
