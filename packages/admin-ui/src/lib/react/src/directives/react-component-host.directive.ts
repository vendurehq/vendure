import { Directive, ElementRef, Injector, Input, Optional } from '@angular/core';
import { PageMetadataService } from '@vendure/admin-ui/core';
import { ComponentProps, createContext, createElement, ElementType } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { HostedReactComponentContext } from '../types';

export const HostedComponentContext = createContext<HostedReactComponentContext | null>(null);

/**
 * Based on https://netbasal.com/using-react-in-angular-applications-1bb907ecac91
 */
@Directive({
    selector: '[vdrReactComponentHost]',
    standalone: true,
})
export class ReactComponentHostDirective<Comp extends ElementType> {
    @Input('vdrReactComponentHost') reactComponent: Comp;
    @Input() props: ComponentProps<Comp>;
    @Input() context: Record<string, any> = {};

    private root: Root | null = null;

    constructor(
        private host: ElementRef,
        private injector: Injector,
        @Optional() private pageMetadataService?: PageMetadataService,
    ) {}

    async ngOnChanges() {
        const Comp = this.reactComponent;

        if (!this.root) {
            this.root = createRoot(this.host.nativeElement);
        }

        this.root.render(
            createElement(
                HostedComponentContext.Provider,
                {
                    value: {
                        ...this.props,
                        ...this.context,
                        injector: this.injector,
                        pageMetadataService: this.pageMetadataService,
                    },
                },
                createElement(Comp, this.props),
            ) as any,
        );
    }

    ngOnDestroy() {
        this.root?.unmount();
    }
}
