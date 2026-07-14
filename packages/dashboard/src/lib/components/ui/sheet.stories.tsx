import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './button.js';
import {
    Sheet,
    SheetClose,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from './sheet.js';

const meta = {
    title: 'UI/Sheet',
    component: Sheet,
    parameters: {
        layout: 'centered',
    },
    tags: ['autodocs'],
} satisfies Meta<typeof Sheet>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
    render: () => (
        <Sheet>
            <SheetTrigger render={<Button />}>Open Sheet</SheetTrigger>
            <SheetContent>
                <SheetHeader>
                    <SheetTitle>Edit profile</SheetTitle>
                    <SheetDescription>
                        Make changes to your profile here. Click save when you're done.
                    </SheetDescription>
                </SheetHeader>
                <div className="grid gap-4 py-4">
                    <p>Sheet content goes here</p>
                </div>
                <SheetFooter>
                    <SheetClose render={<Button type="submit" />}>Save changes</SheetClose>
                </SheetFooter>
            </SheetContent>
        </Sheet>
    ),
};
