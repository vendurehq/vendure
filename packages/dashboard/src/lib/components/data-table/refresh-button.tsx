import { Button } from '@/vdb/components/ui/button.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/vdb/components/ui/tooltip.js';
import { Trans } from '@lingui/react/macro';
import { RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';

function useDelayedLoading(isLoading: boolean, delayMs: number = 100) {
    const [delayedLoading, setDelayedLoading] = useState(isLoading);

    useEffect(() => {
        if (isLoading) {
            // When loading starts, wait for the delay before showing loading state
            const timer = setTimeout(() => {
                setDelayedLoading(true);
            }, delayMs);

            return () => clearTimeout(timer);
        } else {
            // When loading stops, immediately hide loading state
            setDelayedLoading(false);
        }
    }, [isLoading, delayMs]);

    return delayedLoading;
}

export function RefreshButton({
    onRefresh,
    isLoading,
}: Readonly<{ onRefresh: () => void; isLoading: boolean }>) {
    const delayedLoading = useDelayedLoading(isLoading, 100);

    const handleClick = () => {
        onRefresh();
    };

    return (
        <Tooltip>
            <TooltipTrigger render={<Button variant="outline" size="icon-sm" onClick={handleClick} disabled={delayedLoading} data-testid="dt-refresh-button" />}>
                    <RefreshCw className={delayedLoading ? 'animate-rotate' : ''} />
            </TooltipTrigger>
            <TooltipContent>
                <Trans>Refresh data</Trans>
            </TooltipContent>
        </Tooltip>
    );
}
