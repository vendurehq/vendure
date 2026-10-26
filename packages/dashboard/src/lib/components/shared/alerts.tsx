import { AlertItem } from '@/vdb/framework/alert/alert-item.js';
import { AlertsIndicator } from '@/vdb/framework/alert/alerts-indicator.js';
import { useAlerts } from '@/vdb/hooks/use-alerts.js';
import { Trans } from '@lingui/react/macro';
import { BellIcon } from 'lucide-react';
import { Button } from '../ui/button.js';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '../ui/dropdown-menu.js';
import { NoNotificationsIllustration } from '../ui/illustrations.js';
import { ScrollArea } from '../ui/scroll-area.js';
import { EmptyState } from '../ui/state-views.js';

export function Alerts() {
    const { alerts, activeCount } = useAlerts();

    if (alerts.length === 0) {
        return null;
    }

    return (
        <DropdownMenu>
            <DropdownMenuTrigger render={<Button size="icon" variant="ghost" className="relative" />}>
                    <BellIcon />
                    <AlertsIndicator />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-w-[800px] min-w-96">
                <DropdownMenuGroup>
                    <DropdownMenuLabel>
                        <Trans>Alerts</Trans>
                    </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <ScrollArea className="max-h-[500px]">
                    {activeCount > 0 ? (
                        <div className="flex flex-col divide-y divide-border px-2">
                            {alerts.map(alert => (
                                <AlertItem className="py-2" key={alert.definition.id} alert={alert} />
                            ))}
                        </div>
                    ) : (
                        <EmptyState
                            className="border-0 rounded-none bg-transparent"
                            illustration={<NoNotificationsIllustration />}
                            title={<Trans>No alerts</Trans>}
                        />
                    )}
                </ScrollArea>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
