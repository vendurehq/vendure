import { Component, ViewContainerRef } from '@angular/core';

import { OverlayHostService } from '../../providers/overlay-host/overlay-host.service';

/**
 * The OverlayHostComponent is a placeholder component which provides a location in the DOM into which overlay
 * elements (modals, notify notifications etc) may be injected dynamically.
 */
@Component({
    selector: 'vdr-overlay-host',
    template: '<!-- -->',
    standalone: false,
})
export class OverlayHostComponent {
    constructor(viewContainerRef: ViewContainerRef, overlayHostService: OverlayHostService) {
        overlayHostService.registerHostView(viewContainerRef);
    }
}
