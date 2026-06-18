import { Button } from '@/vdb/components/ui/button.js';
import { useUserSettings } from '@/vdb/hooks/use-user-settings.js';
import { Trans } from '@lingui/react/macro';
import { XIcon } from 'lucide-react';

export function DevModeIndicator() {
    const { setDevMode } = useUserSettings();
    return (
        <div className="flex items-center gap-1.5 rounded-md border border-dev-mode/30 bg-dev-mode/10 px-2.5 py-1 text-xs font-mono text-dev-mode">
            <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-dev-mode opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-dev-mode" />
            </span>
            <Trans>Dev Mode</Trans>
            <Button
                variant="ghost"
                size="icon-xs"
                className="h-4 w-4 text-dev-mode hover:text-dev-mode hover:bg-dev-mode/20"
                onClick={() => setDevMode(false)}
            >
                <XIcon className="w-3 h-3" />
            </Button>
        </div>
    );
}
