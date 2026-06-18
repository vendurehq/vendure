import { Directive, ElementRef, HostListener } from '@angular/core';

import { DropdownComponent } from './dropdown.component';

@Directive({
    selector: '[vdrDropdownTrigger]',
    standalone: false,
})
export class DropdownTriggerDirective {
    constructor(
        private dropdown: DropdownComponent,
        private elementRef: ElementRef,
    ) {
        dropdown.setTriggerElement(this.elementRef);
    }

    @HostListener('click', ['$event'])
    onDropdownTriggerClick(event: any): void {
        this.dropdown.toggleOpen();
    }
}
