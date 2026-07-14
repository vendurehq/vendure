import { MenuBranding } from '@/vdb/components/shared/powered-by-vendure.js';
import { useAuth } from '@/vdb/hooks/use-auth.js';
import { Link, useNavigate, useRouter } from '@tanstack/react-router';
import { ChevronsUpDown, LogOut, Monitor, Moon, Sparkles, Sun } from 'lucide-react';

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from '@/vdb/components/ui/dropdown-menu.js';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '@/vdb/components/ui/sidebar.js';
import { useDisplayLocale } from '@/vdb/hooks/use-display-locale.js';
import { useUserSettings } from '@/vdb/hooks/use-user-settings.js';
import { Theme } from '@/vdb/providers/theme-provider.js';
import { Trans } from '@lingui/react/macro';
import { useMemo } from 'react';
import { Dialog, DialogTrigger } from '../ui/dialog.js';
import { LanguageDialog } from './language-dialog.js';

export function NavUser() {
    const { isMobile, state } = useSidebar();
    const router = useRouter();
    const navigate = useNavigate();
    const { humanReadableLanguage } = useDisplayLocale();
    const { user, ...auth } = useAuth();
    const { settings, setTheme, setDevMode } = useUserSettings();

    const handleLogout = () => {
        auth.logout().then(() => {
            router.invalidate().finally(() => {
                navigate({ to: '/login' });
            });
        });
    };

    const avatarFallback = useMemo(() => {
        return (user?.firstName?.charAt(0) ?? '') + (user?.lastName?.charAt(0) ?? '');
    }, [user]);

    if (!user) {
        return <></>;
    }

    const isDevMode = (import.meta as any).env?.MODE === 'development';

    return (
        <SidebarMenu>
            <SidebarMenuItem>
                <Dialog>
                    <DropdownMenu>
                        <DropdownMenuTrigger render={<SidebarMenuButton
                                size="lg"
                                className="data-open:bg-sidebar-accent data-open:text-sidebar-accent-foreground"
                            />}>
                                <div className="relative flex rounded-lg border justify-center items-center w-8 h-8">
                                    {avatarFallback}
                                </div>
                                {state === 'expanded' ? (
                                    <div className="grid flex-1 text-left text-sm leading-tight">
                                        <span className="truncate font-heading font-semibold text-accent-foreground">
                                            {user.firstName} {user.lastName}
                                        </span>
                                        <span className="truncate font-mono text-xs">{user.emailAddress}</span>
                                    </div>
                                ) : null}
                                {state === 'expanded' ? <ChevronsUpDown className="ml-auto size-4" /> : null}
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                            className="w-(--anchor-width) min-w-56 rounded-lg"
                            side={isMobile ? 'bottom' : 'right'}
                            align="end"
                            sideOffset={4}
                        >
                            <DropdownMenuGroup>
                                <DropdownMenuLabel className="p-0 font-normal">
                                    <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                                        <div className="relative flex rounded-lg border justify-center items-center w-8 h-8">
                                            {avatarFallback}
                                        </div>
                                        <div className="grid flex-1 text-left text-sm leading-tight">
                                            <span className="truncate font-heading font-semibold text-accent-foreground">
                                                {user.firstName} {user.lastName}
                                            </span>
                                            <span className="truncate font-mono text-xs">{user.emailAddress}</span>
                                        </div>
                                    </div>
                                </DropdownMenuLabel>
                            </DropdownMenuGroup>
                            <DropdownMenuSeparator />
                            <DropdownMenuGroup>
                                <DropdownMenuItem render={<a href="https://vendure.io/pricing" target="_blank" rel="noopener noreferrer" aria-label="Explore Platform & Cloud" />}>
                                        <Sparkles />
                                        <Trans>Explore Platform & Cloud</Trans>
                                </DropdownMenuItem>
                            </DropdownMenuGroup>
                            <DropdownMenuSeparator />
                            <DropdownMenuGroup>
                                <DropdownMenuItem render={<Link to="/profile" />}>
                                        <Trans>Profile</Trans>
                                </DropdownMenuItem>
                                <DialogTrigger nativeButton={false} render={<DropdownMenuItem className="flex gap-2" />}>
                                        <div>
                                            <Trans>Language</Trans>
                                        </div>
                                        <div className="text-muted-foreground">{humanReadableLanguage}</div>
                                </DialogTrigger>
                                <DropdownMenuSub>
                                    <DropdownMenuSubTrigger>
                                        <Trans>Theme</Trans>
                                    </DropdownMenuSubTrigger>
                                    <DropdownMenuSubContent>
                                        <DropdownMenuRadioGroup
                                            value={settings.theme}
                                            onValueChange={value => setTheme(value as Theme)}
                                        >
                                            <DropdownMenuRadioItem value="light">
                                                <Sun />
                                                <Trans context="theme">Light</Trans>
                                            </DropdownMenuRadioItem>
                                            <DropdownMenuRadioItem value="dark">
                                                <Moon />
                                                <Trans context="theme">Dark</Trans>
                                            </DropdownMenuRadioItem>
                                            <DropdownMenuRadioItem value="system">
                                                <Monitor />
                                                <Trans context="theme">System</Trans>
                                            </DropdownMenuRadioItem>
                                        </DropdownMenuRadioGroup>
                                    </DropdownMenuSubContent>
                                </DropdownMenuSub>
                            </DropdownMenuGroup>
                            {isDevMode && (
                                <DropdownMenuSub>
                                    <DropdownMenuSubTrigger>
                                        <Trans>Dev Mode</Trans>
                                    </DropdownMenuSubTrigger>
                                    <DropdownMenuSubContent>
                                        <DropdownMenuRadioGroup
                                            value={settings.devMode.toString()}
                                            onValueChange={value => setDevMode(value === 'true')}
                                        >
                                            <DropdownMenuRadioItem value="true">
                                                <Trans>Enabled</Trans>
                                            </DropdownMenuRadioItem>
                                            <DropdownMenuRadioItem value="false">
                                                <Trans>Disabled</Trans>
                                            </DropdownMenuRadioItem>
                                        </DropdownMenuRadioGroup>
                                    </DropdownMenuSubContent>
                                </DropdownMenuSub>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={handleLogout}>
                                <LogOut />
                                <Trans>Log out</Trans>
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <MenuBranding />
                        </DropdownMenuContent>
                    </DropdownMenu>
                    <LanguageDialog />
                </Dialog>
            </SidebarMenuItem>
        </SidebarMenu>
    );
}
