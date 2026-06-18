import type { Meta, StoryObj } from '@storybook/react-vite';
import { useForm } from 'react-hook-form';
import { withDescription } from '../../../.storybook/with-description.js';
import { NumberInput } from './number-input.js';

const meta = {
    title: 'Form Inputs/NumberInput',
    component: NumberInput,
    ...withDescription(import.meta.url, './number-input.js'),
    parameters: {
        layout: 'centered',
    },
    tags: ['autodocs'],
    argTypes: {
        value: {
            control: 'number',
            description: 'The current value',
        },
        min: {
            control: 'number',
            description: 'Minimum value',
        },
        max: {
            control: 'number',
            description: 'Maximum value',
        },
        step: {
            control: 'number',
            description: 'Step increment',
        },
        disabled: {
            control: 'boolean',
            description: 'Whether the input is disabled',
        },
    },
} satisfies Meta<typeof NumberInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
    args: {
        value: 42,
        min: 0,
        max: 100,
        step: 1,
        disabled: false,
    },
    render: args => {
        const { register } = useForm();
        const field = register('playground');
        return (
            <div className="w-[300px]">
                <NumberInput {...field} {...args} />
            </div>
        );
    },
};

export const Float: Story = {
    render: () => {
        const { register } = useForm();
        const field = register('float');
        return (
            <div className="w-[300px] space-y-2">
                <NumberInput {...field} step={0.01} fieldDef={{ type: 'float' }} />
                <div className="text-sm text-muted-foreground">
                    <div>Floating point with step 0.01</div>
                </div>
            </div>
        );
    },
};

export const WithPrefixAndSuffix: Story = {
    render: () => {
        const { register } = useForm();
        const field = register('withAffix');
        return (
            <div className="w-[300px] space-y-2">
                <NumberInput {...field} fieldDef={{ ui: { prefix: '$', suffix: 'USD' } }} step={10} />
                <div className="text-sm text-muted-foreground">
                    Demonstrates fieldDef.ui.prefix and fieldDef.ui.suffix
                </div>
            </div>
        );
    },
};

export const NullValue: Story = {
    render: () => {
        const { register } = useForm();
        const field = register('nullValue');
        return (
            <div className="w-[300px] space-y-2">
                <NumberInput {...field} />
                <div className="text-sm text-muted-foreground">
                    <div className="mt-1 text-xs">When input is cleared, value becomes null</div>
                </div>
            </div>
        );
    },
};
