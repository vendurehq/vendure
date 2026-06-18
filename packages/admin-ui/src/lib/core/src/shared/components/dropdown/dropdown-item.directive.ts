import { Directive, HostListener, Inject } from '@angular/core';

import { DropdownComponent } from './dropdown.component';

@Directive({
    selector: '[vdrDropdownItem]',
    // eslint-disable-next-line
    host: { '[class.dropdown-item]': 'true' },
    standalone: false,
})
export class DropdownItemDirective {
    constructor(
        @Inject(DropdownComponent) private dropdown: DropdownComponent | Promise<DropdownComponent>,
    ) {}

    @HostListener('click', ['$event'])
    async onDropdownItemClick() {
        (await this.dropdown).onClick();
    }
}
