import type { Meta, StoryObj } from '@storybook/react-vite';
import { ScrollArea } from './scroll-area.js';
import { Separator } from './separator.js';

const meta = {
    title: 'UI/Scroll Area',
    component: ScrollArea,
    parameters: {
        layout: 'centered',
    },
    tags: ['autodocs'],
} satisfies Meta<typeof ScrollArea>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
    render: () => (
        <ScrollArea className="h-72 w-48 rounded-md border">
            <div className="p-4">
                <h4 className="mb-4 text-sm font-medium leading-none">Tags</h4>
                {Array.from({ length: 50 }).map((_, i) => (
                    <div key={i}>
                        <div className="text-sm">Tag {i + 1}</div>
                        <Separator className="my-2" />
                    </div>
                ))}
            </div>
        </ScrollArea>
    ),
};
