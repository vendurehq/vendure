import {
    Card,
    CardAction,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/vdb/components/ui/card.js';
import { DashboardBaseWidgetProps } from '@/vdb/framework/extension-api/types/index.js';
import { Trans } from '@lingui/react/macro';
import { createContext, useEffect, useRef, useState } from 'react';

export type WidgetDimensions = {
    width: number;
    height: number;
};

export const WidgetContentContext = createContext<WidgetDimensions>({ width: 0, height: 0 });

/**
 * @description
 * A wrapper component that should be used for any custom Insights page widgets.
 * This ensures that your custom widget has all the basic functionality needed to be
 * correctly rendered on the Insights page.
 *
 * @docsCategory extensions-api
 * @docsPage widgets
 * @since 3.3.0
 */
export function DashboardBaseWidget({
    id,
    config,
    children,
    title,
    description,
    actions,
}: DashboardBaseWidgetProps) {
    const wrapperRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const [dimensions, setDimensions] = useState<WidgetDimensions>({ width: 0, height: 0 });

    useEffect(() => {
        const updateDimensions = () => {
            if (contentRef.current) {
                const contentStyles = window.getComputedStyle(contentRef.current);
                const paddingTop = parseFloat(contentStyles.paddingTop);
                const paddingBottom = parseFloat(contentStyles.paddingBottom);
                const paddingLeft = parseFloat(contentStyles.paddingLeft);
                const paddingRight = parseFloat(contentStyles.paddingRight);

                setDimensions({
                    width: contentRef.current.clientWidth - paddingLeft - paddingRight,
                    height: contentRef.current.clientHeight - paddingTop - paddingBottom,
                });
            }
        };

        updateDimensions();
        const observer = new ResizeObserver(updateDimensions);
        if (wrapperRef.current) {
            observer.observe(wrapperRef.current);
        }

        return () => observer.disconnect();
    }, []);

    return (
        <Card ref={wrapperRef} key={`dashboard-widget-${id}`} className="h-full w-full">
            {title && (
                <CardHeader>
                    <CardTitle>
                        <Trans>{title}</Trans>
                    </CardTitle>
                    {description && (
                        <CardDescription className="@max-md/card-header:col-start-1">
                            {description}
                        </CardDescription>
                    )}
                    {actions && (
                        // In a narrow widget the actions move below the title instead of overflowing the card.
                        <CardAction className="@max-md/card-header:col-span-2 @max-md/card-header:col-start-1 @max-md/card-header:row-span-1 @max-md/card-header:row-start-3 @max-md/card-header:mt-2 @max-md/card-header:h-auto @max-md/card-header:max-w-full @max-md/card-header:justify-self-start @max-md/card-header:overflow-x-auto">
                            {actions}
                        </CardAction>
                    )}
                </CardHeader>
            )}
            <CardContent ref={contentRef} className="grow">
                <WidgetContentContext.Provider value={dimensions}>{children}</WidgetContentContext.Provider>
            </CardContent>
        </Card>
    );
}
