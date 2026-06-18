import { Directive, ViewContainerRef } from '@angular/core';

@Directive({
    selector: '[vdrCustomFilterComponentHost]',
    standalone: false,
})
export class CustomFilterComponentDirective {
    constructor(public viewContainerRef: ViewContainerRef) {}
}
