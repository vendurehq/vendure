import { Directive, Input, TemplateRef } from '@angular/core';

@Directive({
    selector: '[vdrSplitViewLeft]',
    standalone: false,
})
export class SplitViewLeftDirective {}

@Directive({
    selector: '[vdrSplitViewRight]',
    standalone: false,
})
export class SplitViewRightDirective {
    constructor(public template: TemplateRef<any>) {}
    @Input() splitViewTitle?: string;
}
