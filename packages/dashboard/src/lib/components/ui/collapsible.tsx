import { CollapsiblePrimitive } from '@vendure-io/ui/lib/base-ui';
import { cn } from '@/vdb/lib/utils.js';

function Collapsible({ ...props }: CollapsiblePrimitive.Root.Props) {
    return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />;
}

function CollapsibleTrigger({ ...props }: CollapsiblePrimitive.Trigger.Props) {
    return <CollapsiblePrimitive.Trigger data-slot="collapsible-trigger" {...props} />;
}

function CollapsibleContent({ className, ...props }: CollapsiblePrimitive.Panel.Props) {
    return (
        <CollapsiblePrimitive.Panel
            data-slot="collapsible-content"
            className={cn(
                'h-(--collapsible-panel-height) overflow-hidden transition-all data-ending-style:h-0 data-starting-style:h-0',
                className,
            )}
            {...props}
        />
    );
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent };
