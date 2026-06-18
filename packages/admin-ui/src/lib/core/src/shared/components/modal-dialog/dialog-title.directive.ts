import { Directive, OnInit, TemplateRef } from '@angular/core';

import { ModalDialogComponent } from './modal-dialog.component';

/**
 * A helper directive used to correctly embed the modal title in the {@link ModalDialogComponent}.
 */
@Directive({
    selector: '[vdrDialogTitle]',
    standalone: false,
})
export class DialogTitleDirective implements OnInit {
    constructor(
        private modal: ModalDialogComponent<any>,
        private templateRef: TemplateRef<any>,
    ) {}

    ngOnInit() {
        // setTimeout due to https://github.com/angular/angular/issues/15634
        setTimeout(() => this.modal.registerTitleTemplate(this.templateRef));
    }
}
