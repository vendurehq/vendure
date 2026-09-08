import { formatShortcut } from '../../../keyboard-shortcut.js';
import { Button } from '../../ui/button.js';
import { Toggle } from '../../ui/toggle.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../ui/tooltip.js';
export { formatShortcut } from '../../../keyboard-shortcut.js';

export interface ToolbarButtonProps {
    label: string;
    shortcut?: string;
    /** When provided, the button renders as a toggle with aria-pressed semantics */
    isActive?: boolean;
    disabled?: boolean;
    onClick: () => void;
    children: React.ReactNode;
}

export function ToolbarButton({
    label,
    shortcut,
    isActive,
    disabled,
    onClick,
    children,
}: Readonly<ToolbarButtonProps>) {
    const control =
        isActive !== undefined ? (
            <Toggle
                size="sm"
                className="h-8 w-8 p-0"
                pressed={isActive}
                onPressedChange={() => onClick()}
                aria-label={label}
                disabled={disabled}
            />
        ) : (
            <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => onClick()}
                aria-label={label}
                disabled={disabled}
            />
        );

    return (
        <Tooltip>
            <TooltipTrigger render={control}>{children}</TooltipTrigger>
            <TooltipContent>
                <span className="flex items-center gap-1.5">
                    {label}
                    {shortcut ? <kbd className="opacity-60">{formatShortcut(shortcut)}</kbd> : null}
                </span>
            </TooltipContent>
        </Tooltip>
    );
}
