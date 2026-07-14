import { Button } from '@/vdb/components/ui/button.js';
import { AlertEntry } from '@/vdb/hooks/use-alerts.js';
import { cn } from '@/vdb/lib/utils.js';
import { ComponentProps } from 'react';

interface AlertItemProps extends ComponentProps<'div'> {
    alert: AlertEntry;
}

export function AlertItem({ alert, className, ...props }: Readonly<AlertItemProps>) {
    if (!alert.active) {
        return null;
    }
    const { definition: def } = alert;

    return (
        <div className={cn('flex items-center justify-between gap-1', className)} {...props}>
            <div className="flex flex-col">
                <span className="text-sm">
                    {typeof def.title === 'string' ? def.title : def.title(alert.lastData)}
                </span>
                <span className="text-xs text-muted-foreground">
                    {typeof def.description === 'string'
                        ? def.description
                        : def.description?.(alert.lastData)}
                </span>
            </div>
            <div className="flex items-center gap-1">
                {def.actions?.map((action, index) => {
                    if (action.component) {
                        const ActionComponent = action.component;
                        return (
                            <ActionComponent
                                key={action.label ?? index}
                                data={alert.lastData}
                                dismiss={() => alert.dismiss()}
                            />
                        );
                    }
                    return (
                        <Button
                            key={action.label}
                            variant="secondary"
                            size="sm"
                            onClick={async () => {
                                await action.onClick?.({
                                    data: alert.lastData,
                                    dismiss: () => alert.dismiss(),
                                });
                            }}
                        >
                            {action.label}
                        </Button>
                    );
                })}
            </div>
        </div>
    );
}
