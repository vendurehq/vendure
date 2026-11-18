import { Chip } from '@/vdb/components/ui/chip.js';
import { useUserSettings } from '@/vdb/hooks/use-user-settings.js';
import { Trans, useLingui } from '@lingui/react/macro';

export function DevModeIndicator() {
    const { setDevMode } = useUserSettings();
    const { t } = useLingui();
    return (
        <Chip
            className="border-dev-mode/30 bg-dev-mode/10 font-mono text-dev-mode"
            icon={
                <span className="relative flex size-2">
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-dev-mode opacity-75" />
                    <span className="relative inline-flex size-2 rounded-full bg-dev-mode" />
                </span>
            }
            onRemove={() => setDevMode(false)}
            removeLabel={t`Turn off dev mode`}
        >
            <Trans>Dev Mode</Trans>
        </Chip>
    );
}
