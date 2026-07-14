import { Button } from '@/vdb/components/ui/button.js';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/vdb/components/ui/dropdown-menu.js';
import { cn } from '@/vdb/lib/utils.js';
import { orderStateDictionary } from '@/vdb/utils/state-type.js';
import type { Tone } from '@/vdb/components/ui/status-badge.js';
import { Trans } from '@lingui/react/macro';
import { CircleAlert, CircleCheck, CircleDashed, CircleX, EllipsisVertical } from 'lucide-react';
import type { ReactNode } from 'react';

export type StateTransitionAction = {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    tone?: Tone;
    /** Marks an irreversible transition (e.g. cancel) so it renders with destructive styling. */
    destructive?: boolean;
};

type StateTransitionControlProps = {
    currentState: string;
    statesTranslationFunction: (state: string) => string;
    actions: StateTransitionAction[];
    isLoading?: boolean;
};

export function StateTransitionControl({
    currentState,
    statesTranslationFunction,
    actions,
    isLoading,
}: Readonly<StateTransitionControlProps>) {
    const currentTone = orderStateDictionary.toneFor(currentState);
    const iconForTone: Record<Tone, ReactNode> = {
        critical: <CircleX className="h-4 w-4 text-destructive" />,
        success: <CircleCheck className="h-4 w-4 text-success" />,
        warning: <CircleAlert className="h-4 w-4 text-warning" />,
        info: <CircleDashed className="h-4 w-4 text-muted-foreground" />,
        progress: <CircleDashed className="h-4 w-4 text-muted-foreground" />,
        neutral: <CircleDashed className="h-4 w-4 text-muted-foreground" />,
    };

    return (
        <div className="flex min-w-0">
            <div
                className={cn(
                    'inline-flex flex-nowrap items-center justify-start gap-1 h-8 rounded-md px-3 text-xs font-medium border border-input bg-background min-w-0',
                    actions.length > 0 && 'rounded-r-none',
                )}
                title={statesTranslationFunction(currentState)}
            >
                <div className="flex-shrink-0">{iconForTone[currentTone]}</div>
                <span className="truncate">{statesTranslationFunction(currentState)}</span>
            </div>
            {actions.length > 0 && (
                <DropdownMenu>
                    <DropdownMenuTrigger render={<Button
                            variant="outline"
                            size="sm"
                            disabled={isLoading}
                            className={cn('rounded-l-none border-l-0 shadow-none', 'bg-background')}
                            data-testid="state-transition-trigger"
                        />}>
                        <EllipsisVertical className="h-4 w-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-48">
                        {actions.map((action, index) => {
                            return (
                                <DropdownMenuItem
                                    key={action.label + index}
                                    onClick={action.onClick}
                                    variant={action.destructive ? 'destructive' : 'default'}
                                    disabled={action.disabled || isLoading}
                                >
                                    {action.destructive
                                        ? iconForTone.critical
                                        : iconForTone[action.tone ?? 'neutral']}
                                    <Trans>{action.label}</Trans>
                                </DropdownMenuItem>
                            );
                        })}
                    </DropdownMenuContent>
                </DropdownMenu>
            )}
        </div>
    );
}
