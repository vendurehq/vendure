import { Button } from '@/vdb/components/ui/button.js';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/vdb/components/ui/dialog.js';
import { useDynamicTranslations } from '@/vdb/hooks/use-dynamic-translations.js';
import { useServerConfig } from '@/vdb/hooks/use-server-config.js';
import { cn } from '@/vdb/lib/utils.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { ArrowRight, Workflow } from 'lucide-react';
import { useMemo } from 'react';
import { isDestructiveTransition, orderStateDictionary } from '@/vdb/utils/state-type.js';
import type { Tone } from '@/vdb/components/ui/status-badge.js';

interface OrderProcessDialogProps {
    currentState: string;
}

// Subtle tone slots, matching the StatusBadge treatment — a tinted background,
// readable foreground and matching border per tone (no full-strength fills).
const stateColors: Record<Tone, { bg: string; border: string; text: string }> = {
    neutral: {
        bg: 'bg-neutral-subtle',
        border: 'border-neutral-border',
        text: 'text-neutral-subtle-foreground',
    },
    info: {
        bg: 'bg-info-subtle',
        border: 'border-info-border',
        text: 'text-info-subtle-foreground',
    },
    success: {
        bg: 'bg-success-subtle',
        border: 'border-success-border',
        text: 'text-success-subtle-foreground',
    },
    warning: {
        bg: 'bg-warning-subtle',
        border: 'border-warning-border',
        text: 'text-warning-subtle-foreground',
    },
    critical: {
        bg: 'bg-destructive-subtle',
        border: 'border-destructive-border',
        text: 'text-destructive-subtle-foreground',
    },
    progress: {
        bg: 'bg-neutral-subtle',
        border: 'border-neutral-border',
        text: 'text-neutral-subtle-foreground',
    },
};

export function OrderProcessDialog({ currentState }: Readonly<OrderProcessDialogProps>) {
    const { t } = useLingui();
    const { getTranslatedOrderState } = useDynamicTranslations();
    const serverConfig = useServerConfig();
    const orderProcess = serverConfig?.orderProcess ?? [];

    const nextStates = useMemo(() => {
        const nextSet = new Set<string>();
        for (const state of orderProcess) {
            if (state.name === currentState) {
                for (const to of state.to) {
                    nextSet.add(to);
                }
            }
        }
        return nextSet;
    }, [orderProcess, currentState]);

    if (orderProcess.length === 0) return null;

    return (
        <Dialog>
            <DialogTrigger
                render={
                    <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8 flex-shrink-0"
                        aria-label={t`View order process`}
                    />
                }
            >
                <Workflow className="h-4 w-4" />
            </DialogTrigger>
            <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
                <DialogHeader>
                    <DialogTitle>
                        <Trans>Order process</Trans>
                    </DialogTitle>
                    <DialogDescription>
                        <Trans>
                            All possible order states and their transitions. The current state is
                            highlighted.
                        </Trans>
                    </DialogDescription>
                </DialogHeader>
                <div className="overflow-auto flex-1 -mx-6 px-6 pb-2">
                    <div className="space-y-2">
                        {orderProcess.map(state => {
                            const tone = orderStateDictionary.toneFor(state.name);
                            const colors = stateColors[tone];
                            const isCurrent = state.name === currentState;
                            const isNext = nextStates.has(state.name);

                            return (
                                <div key={state.name} className="flex items-start gap-3">
                                    <div
                                        className={cn(
                                            'flex-shrink-0 w-52 rounded-md border px-3 py-2 text-sm font-medium',
                                            colors.bg,
                                            colors.border,
                                            colors.text,
                                            isCurrent &&
                                                'ring-2 ring-primary ring-offset-2 ring-offset-background',
                                            // Dashed border for reachable next states, excluding
                                            // hard-failure states and destructive (irreversible)
                                            // transitions like cancel to avoid visually suggesting them
                                            isNext &&
                                                !isCurrent &&
                                                tone !== 'critical' &&
                                                !isDestructiveTransition(state.name) &&
                                                'border-dashed',
                                        )}
                                    >
                                        {getTranslatedOrderState(state.name)}
                                    </div>
                                    {state.to.length > 0 && (
                                        <div className="flex gap-2 min-h-[36px]">
                                            <ArrowRight className="h-4 w-4 flex-shrink-0 text-muted-foreground mt-1.5" />
                                            <div className="flex flex-wrap gap-1 items-start">
                                                {state.to.map(target => {
                                                    const targetTone = orderStateDictionary.toneFor(target);
                                                    const targetColors = stateColors[targetTone];
                                                    const isTargetCurrent = target === currentState;
                                                    return (
                                                        <span
                                                            key={target}
                                                            className={cn(
                                                                'inline-flex items-center rounded px-2 py-0.5 text-xs border',
                                                                targetColors.bg,
                                                                targetColors.border,
                                                                targetColors.text,
                                                                isTargetCurrent && 'font-semibold',
                                                            )}
                                                        >
                                                            {getTranslatedOrderState(target)}
                                                        </span>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
