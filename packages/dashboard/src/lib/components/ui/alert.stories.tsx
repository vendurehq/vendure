import type { Meta, StoryObj } from '@storybook/react-vite';
import { AlertCircle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from './alert.js';

const meta = {
    title: 'UI/Alert',
    component: Alert,
    parameters: {
        layout: 'centered',
    },
    tags: ['autodocs'],
    argTypes: {
        tone: {
            control: 'select',
            options: [undefined, 'neutral', 'info', 'success', 'warning', 'critical', 'progress'],
            description: 'Alert tone',
        },
    },
} satisfies Meta<typeof Alert>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
    render: args => (
        <Alert {...args} className="w-[400px]" icon={<AlertCircle />}>
            <AlertTitle>Heads up!</AlertTitle>
            <AlertDescription>You can add components to your app using the cli.</AlertDescription>
        </Alert>
    ),
    args: {
        variant: 'default',
    },
};
