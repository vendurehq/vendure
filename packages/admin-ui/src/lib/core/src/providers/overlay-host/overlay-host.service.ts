import { Injectable, ViewContainerRef } from '@angular/core';

/**
 * The OverlayHostService is used to get a reference to the ViewConainerRef of the
 * OverlayHost component, so that other components may insert components & elements
 * into the DOM at that point.
 */
@Injectable({
    providedIn: 'root',
})
export class OverlayHostService {
    private hostView: ViewContainerRef;
    private promiseResolveFns: Array<(result: any) => void> = [];

    /**
     * Used to pass in the ViewContainerRed from the OverlayHost component.
     * Should not be used by any other component.
     */
    registerHostView(viewContainerRef: ViewContainerRef): void {
        this.hostView = viewContainerRef;
        if (0 < this.promiseResolveFns.length) {
            this.resolveHostView();
        }
    }

    /**
     * Returns a promise which resolves to the ViewContainerRef of the OverlayHost
     * component. This can then be used to insert components and elements into the
     * DOM at that point.
     */
    getHostView(): Promise<ViewContainerRef> {
        return new Promise((resolve: (result: any) => void) => {
            this.promiseResolveFns.push(resolve);
            if (this.hostView !== undefined) {
                this.resolveHostView();
            }
        });
    }

    private resolveHostView(): void {
        this.promiseResolveFns.forEach(resolve => resolve(this.hostView));
        this.promiseResolveFns = [];
    }
}
