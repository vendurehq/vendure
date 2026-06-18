import {
    Badge,
    Button,
    defineDashboardExtension,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@vendure/dashboard';
import {
    BellRingIcon,
    CloudIcon,
    MessageSquareIcon,
    RocketIcon,
    SearchIcon,
    ZapIcon,
} from 'lucide-react';
import { useState } from 'react';

/**
 * Search trigger — positioned before alerts, demonstrates a common use case.
 */
function SearchTrigger() {
    return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => alert('Search triggered! In a real plugin, this would open a command palette.')}
                    >
                        <SearchIcon className="h-4 w-4" />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>Search (⌘K)</TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
}

/**
 * Environment badge — no position specified (goes before all built-in items).
 * Shows a coloured badge indicating the current environment.
 */
function EnvironmentBadge() {
    return (
        <Badge variant="outline" className="text-orange-600 border-orange-400 gap-1">
            <CloudIcon className="h-3 w-3" />
            Staging
        </Badge>
    );
}

/**
 * Notification bell with count — replaces the built-in alerts icon.
 * Demonstrates the 'replace' positioning.
 */
function CustomNotifications() {
    const [count, setCount] = useState(3);
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="relative">
                    <BellRingIcon className="h-4 w-4" />
                    {count > 0 && (
                        <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-destructive text-[10px] font-medium text-destructive-foreground flex items-center justify-center">
                            {count}
                        </span>
                    )}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel>Notifications ({count})</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setCount(c => Math.max(0, c - 1))}>
                    <RocketIcon className="h-4 w-4 mr-2" />
                    New deployment ready
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setCount(c => Math.max(0, c - 1))}>
                    <MessageSquareIcon className="h-4 w-4 mr-2" />
                    2 new reviews pending
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setCount(c => Math.max(0, c - 1))}>
                    <ZapIcon className="h-4 w-4 mr-2" />
                    Sync completed
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

/**
 * Quick-action button — positioned after the dev mode indicator.
 */
function QuickAction() {
    return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => alert('Quick action!')}
                    >
                        <ZapIcon className="h-4 w-4" />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>Quick action</TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
}

defineDashboardExtension({
    toolbarItems: [
        {
            id: 'env-badge',
            component: EnvironmentBadge,
            // No position — goes before all built-in items
        },
        {
            id: 'search-trigger',
            component: SearchTrigger,
            position: { itemId: 'alerts', order: 'before' },
        },
        {
            id: 'quick-action',
            component: QuickAction,
            position: { itemId: 'dev-mode-indicator', order: 'after' },
        },
        {
            id: 'custom-notifications',
            component: CustomNotifications,
            position: { itemId: 'alerts', order: 'replace' },
        },
    ],
});
