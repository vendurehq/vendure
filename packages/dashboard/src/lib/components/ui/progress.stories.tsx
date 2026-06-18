import type { Meta, StoryObj } from '@storybook/react-vite';
import { Progress } from './progress.js';

const meta = {
    title: 'UI/Progress',
    component: Progress,
    parameters: {
        layout: 'centered',
    },
    tags: ['autodocs'],
    argTypes: {
        value: {
            control: { type: 'range', min: 0, max: 100, step: 1 },
            description: 'Progress value (0-100)',
        },
    },
} satisfies Meta<typeof Progress>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
    args: {
        value: 60,
    },
    render: args => <Progress {...args} className="w-[300px]" />,
};
