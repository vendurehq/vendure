import { Directive, TemplateRef } from '@angular/core';

@Directive({
    selector: '[vdrZoneMemberControls]',
    standalone: false
})
export class ZoneMemberControlsDirective {
    constructor(public templateRef: TemplateRef<any>) {}
}
