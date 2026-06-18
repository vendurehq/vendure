import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Button } from './button.js';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from './dialog.js';

const meta = {
    title: 'UI/Dialog',
    component: Dialog,
    parameters: {
        layout: 'centered',
    },
    tags: ['autodocs'],
} satisfies Meta<typeof Dialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
    render: () => {
        const [open, setOpen] = useState(false);
        return (
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger render={<Button />}>Open Dialog</DialogTrigger>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Dialog Title</DialogTitle>
                        <DialogDescription>
                            This is a dialog description. You can add any content here.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="py-4">Dialog content goes here</div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setOpen(false)}>
                            Cancel
                        </Button>
                        <Button onClick={() => setOpen(false)}>Confirm</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        );
    },
};
