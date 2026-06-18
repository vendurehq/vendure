import type { Meta, StoryObj } from '@storybook/react-vite';
import { useForm } from 'react-hook-form';
import { withDescription } from '../../../.storybook/with-description.js';
import { CheckboxInput } from './checkbox-input.js';

const meta = {
    title: 'Form Inputs/CheckboxInput',
    component: CheckboxInput,
    ...withDescription(import.meta.url, './checkbox-input.js'),
    parameters: {
        layout: 'centered',
    },
    tags: ['autodocs'],
    argTypes: {
        value: {
            control: 'boolean',
            description: 'Whether the checkbox is checked',
        },
    },
} satisfies Meta<typeof CheckboxInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
    args: {
        value: false,
    },
    render: args => {
        const { register } = useForm();
        const field = register('playground');
        return (
            <div className="flex items-center gap-2">
                <CheckboxInput {...field} {...args} />
                <label className="text-sm font-medium">Accept terms and conditions</label>
            </div>
        );
    },
};

export const MultipleCheckboxes: Story = {
    render: () => {
        const { register } = useForm();
        return (
            <div className="space-y-3">
                <div className="flex items-center gap-2">
                    <CheckboxInput {...register('notifications')} />
                    <label className="text-sm font-medium">Email notifications</label>
                </div>
                <div className="flex items-center gap-2">
                    <CheckboxInput {...register('marketing')} />
                    <label className="text-sm font-medium">Marketing emails</label>
                </div>
                <div className="flex items-center gap-2">
                    <CheckboxInput {...register('updates')} />
                    <label className="text-sm font-medium">Product updates</label>
                </div>
            </div>
        );
    },
};
