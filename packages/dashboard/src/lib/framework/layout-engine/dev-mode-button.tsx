import { Button } from '@/vdb/components/ui/button.js';
import { cn } from '@/vdb/lib/utils.js';
import { Crosshair } from 'lucide-react';
import { forwardRef } from 'react';

export const DevModeButton = forwardRef<HTMLButtonElement, React.ComponentProps<typeof Button>>(
    (props, ref) => {
        const { className, ...rest } = props;
        return (
            <div className="relative">
                <Button
                    ref={ref}
                    variant="secondary"
                    size="icon"
                    className={cn(
                        'h-6 w-6 absolute z-50 rounded-md bg-background text-dev-mode/70 hover:bg-background hover:text-dev-mode border border-dev-mode',
                        className,
                    )}
                    {...rest}
                >
                    <Crosshair className="w-4 h-4" />
                </Button>
            </div>
        );
    },
);
