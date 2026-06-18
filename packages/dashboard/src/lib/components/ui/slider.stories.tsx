import type { Meta, StoryObj } from '@storybook/react-vite';
import { Slider } from './slider.js';

const meta = {
    title: 'UI/Slider',
    component: Slider,
    parameters: {
        layout: 'centered',
    },
    tags: ['autodocs'],
    argTypes: {
        defaultValue: {
            control: { type: 'array' },
            description: 'Default value',
        },
        max: {
            control: 'number',
            description: 'Maximum value',
        },
        step: {
            control: 'number',
            description: 'Step increment',
        },
    },
} satisfies Meta<typeof Slider>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
    args: {
        defaultValue: [50],
        max: 100,
        step: 1,
    },
    render: args => <Slider {...args} className="w-[300px]" />,
};
