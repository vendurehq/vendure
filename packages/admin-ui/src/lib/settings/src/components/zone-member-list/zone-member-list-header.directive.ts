import { Directive, TemplateRef } from '@angular/core';

@Directive({
    selector: '[vdrZoneMemberListHeader]',
    standalone: false
})
export class ZoneMemberListHeaderDirective {
    constructor(public templateRef: TemplateRef<any>) {}
}
