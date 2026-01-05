import { ChevronsUpDown, Languages, Plus } from 'lucide-react';

import { ChannelCodeLabel } from '@/vdb/components/shared/channel-code-label.js';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from '@/vdb/components/ui/dropdown-menu.js';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '@/vdb/components/ui/sidebar.js';
import { DEFAULT_CHANNEL_CODE } from '@/vdb/constants.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { useLocalFormat } from '@/vdb/hooks/use-local-format.js';
import { useServerConfig } from '@/vdb/hooks/use-server-config.js';
import { useSortedLanguages } from '@/vdb/hooks/use-sorted-languages.js';
import { useUserSettings } from '@/vdb/hooks/use-user-settings.js';
import { cn } from '@/vdb/lib/utils.js';
import { Trans } from '@lingui/react/macro';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { ManageLanguagesDialog } from './manage-languages-dialog.js';

/**
 * Convert the channel code to initials.
 * Splits by punctuation like '-' and '_' and takes the first letter of each part
 * up to 3 parts.
 *
 * If no splits, takes the first 3 letters.
 */
function getChannelInitialsFromCode(code: string) {
    const parts = code.split(/[-_]/);
    if (parts.length > 1) {
        return parts
            .filter(part => part.length > 0)
            .slice(0, 3)
            .map(part => part[0])
            .join('');
    } else {
        return code.slice(0, 3);
    }
}

export function ChannelSwitcher() {
    const { isMobile } = useSidebar();
    const { channels, activeChannel, setActiveChannel } = useChannel();
    const serverConfig = useServerConfig();
    const { formatLanguageName } = useLocalFormat();
    const {
        settings: { contentLanguage },
        setContentLanguage,
    } = useUserSettings();
    const [showManageLanguagesDialog, setShowManageLanguagesDialog] = useState(false);
    const displayChannel = activeChannel;

    // Get available languages from server config
    const availableLanguages = serverConfig?.availableLanguages || [];
    const hasMultipleLanguages = availableLanguages.length > 1;

    // Reorder channels to put the currently selected one first
    const orderedChannels = displayChannel
        ? [displayChannel, ...channels.filter(ch => ch.id !== displayChannel.id)]
        : channels;

    // Sort language codes by their formatted names and map to code and label
    const sortedLanguages = useSortedLanguages(displayChannel?.availableLanguageCodes);

    useEffect(() => {
        if (activeChannel?.availableLanguageCodes) {
            // Ensure the current content language is a valid one for the active
            // channel
            if (!activeChannel.availableLanguageCodes.includes(contentLanguage as any)) {
                setContentLanguage(activeChannel.defaultLanguageCode);
            }
        }
    }, [activeChannel, contentLanguage]);

    return (
        <>
            <SidebarMenu>
                <SidebarMenuItem>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <SidebarMenuButton
                                size="lg"
                                className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                            >
                                <div
                                    className={
                                        'bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg'
                                    }
                                >
                                    <span className="truncate font-semibold text-xs uppercase">
                                        {getChannelInitialsFromCode(displayChannel?.code || '')}
                                    </span>
                                </div>
                                <div className="grid flex-1 text-left text-sm leading-tight">
                                    <span className="truncate font-semibold">
                                        <ChannelCodeLabel code={displayChannel?.code} />
                                    </span>
                                    <span className="truncate text-xs">
                                        <span>
                                            <Trans>Language: {formatLanguageName(contentLanguage)}</Trans>
                                        </span>
                                    </span>
                                </div>
                                <ChevronsUpDown className="ml-auto" />
                            </SidebarMenuButton>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
                            align="start"
                            side={isMobile ? 'bottom' : 'right'}
                            sideOffset={4}
                        >
                            <DropdownMenuLabel className="text-muted-foreground text-xs">
                                <Trans>Channels</Trans>
                            </DropdownMenuLabel>
                            {orderedChannels.map((channel, index) => (
                                <div key={channel.code}>
                                    <DropdownMenuItem
                                        onClick={() => setActiveChannel(channel.id)}
                                        className="gap-2 p-2"
                                    >
                                        <div
                                            className={cn(
                                                'flex size-8 items-center justify-center rounded border',
                                                channel.code === DEFAULT_CHANNEL_CODE ? 'bg-primary' : '',
                                            )}
                                        >
                                            <span className="truncate font-semibold text-xs uppercase">
                                                {getChannelInitialsFromCode(channel.code)}
                                            </span>
                                        </div>
                                        <ChannelCodeLabel code={channel.code} />
                                        {channel.id === displayChannel?.id && (
                                            <span className="ms-auto text-xs text-muted-foreground">
                                                <Trans context="current channel">Current</Trans>
                                            </span>
                                        )}
                                    </DropdownMenuItem>
                                    {/* Show language sub-menu for the current channel */}
                                    {channel.id === displayChannel?.id && (
                                        <DropdownMenuSub>
                                            <DropdownMenuSubTrigger className="gap-2 p-2 ps-4">
                                                <Languages className="w-4 h-4" />
                                                <div className="flex gap-1 ms-2">
                                                    <span className="text-muted-foreground">
                                                        <Trans>Content:</Trans>
                                                    </span>
                                                    {formatLanguageName(contentLanguage)}
                                                </div>
                                            </DropdownMenuSubTrigger>
                                            <DropdownMenuSubContent>
                                                {sortedLanguages?.map(({ code: languageCode, label }) => (
                                                    <DropdownMenuItem
                                                        key={`${channel.code}-${languageCode}`}
                                                        onClick={() => setContentLanguage(languageCode)}
                                                        className={`gap-2 p-2 ${contentLanguage === languageCode ? 'bg-accent' : ''}`}
                                                    >
                                                        <div className="flex w-6 h-5 items-center justify-center rounded border">
                                                            <span className="truncate font-medium text-xs">
                                                                {languageCode.toUpperCase()}
                                                            </span>
                                                        </div>
                                                        <span>{label}</span>
                                                        {contentLanguage === languageCode && (
                                                            <span className="ms-auto text-xs text-muted-foreground">
                                                                <Trans context="active language">
                                                                    Active
                                                                </Trans>
                                                            </span>
                                                        )}
                                                    </DropdownMenuItem>
                                                ))}
                                                <DropdownMenuSeparator />
                                                <DropdownMenuItem
                                                    onClick={() => setShowManageLanguagesDialog(true)}
                                                    className="gap-2 p-2"
                                                >
                                                    <Languages className="w-4 h-4" />
                                                    <span>
                                                        <Trans>Manage Languages</Trans>
                                                    </span>
                                                </DropdownMenuItem>
                                            </DropdownMenuSubContent>
                                        </DropdownMenuSub>
                                    )}
                                    {/* Add separator after the current channel group */}
                                    {channel.id === displayChannel?.id &&
                                        index === 0 &&
                                        orderedChannels.length > 1 && <DropdownMenuSeparator />}
                                </div>
                            ))}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="gap-2 p-2 cursor-pointer" asChild>
                                <Link to={'/channels/new'}>
                                    <div className="bg-background flex size-6 items-center justify-center rounded-md border">
                                        <Plus className="size-4" />
                                    </div>
                                    <div className="text-muted-foreground font-medium">
                                        <Trans>Add channel</Trans>
                                    </div>
                                </Link>
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </SidebarMenuItem>
            </SidebarMenu>
            <ManageLanguagesDialog
                open={showManageLanguagesDialog}
                onClose={() => setShowManageLanguagesDialog(false)}
            />
        </>
    );
}
