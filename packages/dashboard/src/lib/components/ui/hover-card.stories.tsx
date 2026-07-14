import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './button.js';
import { HoverCard, HoverCardContent, HoverCardTrigger } from './hover-card.js';

const meta = {
    title: 'UI/Hover Card',
    component: HoverCard,
    parameters: {
        layout: 'centered',
    },
    tags: ['autodocs'],
} satisfies Meta<typeof HoverCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
    render: () => (
        <HoverCard>
            <HoverCardTrigger render={<Button variant="link" />}>@username</HoverCardTrigger>
            <HoverCardContent className="w-80">
                <div className="flex justify-between space-x-4">
                    <div className="space-y-1">
                        <h4 className="text-sm font-semibold">@username</h4>
                        <p className="text-sm">
                            The React Framework – created and maintained by @vercel.
                        </p>
                        <div className="flex items-center pt-2">
                            <span className="text-xs text-muted-foreground">Joined December 2021</span>
                        </div>
                    </div>
                </div>
            </HoverCardContent>
        </HoverCard>
    ),
};
