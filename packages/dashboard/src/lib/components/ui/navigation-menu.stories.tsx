import type { Meta, StoryObj } from '@storybook/react-vite';
import {
    NavigationMenu,
    NavigationMenuContent,
    NavigationMenuItem,
    NavigationMenuLink,
    NavigationMenuList,
    NavigationMenuTrigger,
} from './navigation-menu.js';

const meta = {
    title: 'UI/Navigation Menu',
    component: NavigationMenu,
    parameters: {
        layout: 'centered',
    },
    tags: ['autodocs'],
} satisfies Meta<typeof NavigationMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
    render: () => (
        <NavigationMenu>
            <NavigationMenuList>
                <NavigationMenuItem>
                    <NavigationMenuTrigger>Getting started</NavigationMenuTrigger>
                    <NavigationMenuContent>
                        <div className="grid gap-3 p-6 w-[400px]">
                            <NavigationMenuLink className="block p-3 rounded-md hover:bg-accent">
                                <div className="font-medium">Introduction</div>
                                <div className="text-sm text-muted-foreground">
                                    Re-usable components built using Radix UI and Tailwind CSS.
                                </div>
                            </NavigationMenuLink>
                            <NavigationMenuLink className="block p-3 rounded-md hover:bg-accent">
                                <div className="font-medium">Installation</div>
                                <div className="text-sm text-muted-foreground">
                                    How to install dependencies and structure your app.
                                </div>
                            </NavigationMenuLink>
                        </div>
                    </NavigationMenuContent>
                </NavigationMenuItem>
                <NavigationMenuItem>
                    <NavigationMenuLink href="/docs" className="px-4 py-2">
                        Documentation
                    </NavigationMenuLink>
                </NavigationMenuItem>
            </NavigationMenuList>
        </NavigationMenu>
    ),
};
