import { Button } from '@/vdb/components/ui/button.js';
import { ButtonGroup, ButtonGroupText } from '@/vdb/components/ui/button-group.js';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/vdb/components/ui/dropdown-menu.js';
import type { Tone } from '@/vdb/components/ui/status-badge.js';
import { orderStateDictionary } from '@/vdb/utils/state-type.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { CircleAlert, CircleCheck, CircleDashed, CircleX, Ellipsis } from 'lucide-react';
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
    const { t } = useLingui();
    const currentTone = orderStateDictionary.toneFor(currentState);
    const iconForTone: Record<Tone, ReactNode> = {
        critical: <CircleX className="h-4 w-4 text-destructive" />,
        success: <CircleCheck className="h-4 w-4 text-success" />,
        warning: <CircleAlert className="h-4 w-4 text-warning" />,
        info: <CircleDashed className="h-4 w-4 text-muted-foreground" />,
        progress: <CircleDashed className="h-4 w-4 text-muted-foreground" />,
        neutral: <CircleDashed className="h-4 w-4 text-muted-foreground" />,
    };

    const label = statesTranslationFunction(currentState);

    return (
        <ButtonGroup className="max-w-full">
            <ButtonGroupText className="min-w-0">
                {iconForTone[currentTone]}
                <span
                    className="truncate"
                    // Name the full state only when the label is cut off.
                    onPointerEnter={e => {
                        const el = e.currentTarget;
                        el.title = el.scrollWidth > el.clientWidth ? label : '';
                    }}
                >
                    {label}
                </span>
            </ButtonGroupText>
            {actions.length > 0 && (
                <DropdownMenu>
                    <DropdownMenuTrigger
                        render={
                            <Button
                                variant="outline"
                                size="icon"
                                disabled={isLoading}
                                aria-label={t`Change state`}
                                data-testid="state-transition-trigger"
                            />
                        }
                    >
                        <Ellipsis className="h-4 w-4" />
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
        </ButtonGroup>
    );
}
