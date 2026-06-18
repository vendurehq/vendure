import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { FormControl, UntypedFormGroup, Validators } from '@angular/forms';

import { Dialog } from '../../../../providers/modal/modal.types';

export interface LinkAttrs {
    href: string;
    title: string;
    target?: string;
}

@Component({
    selector: 'vdr-link-dialog',
    templateUrl: './link-dialog.component.html',
    styleUrls: ['./link-dialog.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class LinkDialogComponent implements OnInit, Dialog<LinkAttrs> {
    form: UntypedFormGroup;

    resolveWith: (result?: LinkAttrs) => void;
    existing?: LinkAttrs;

    ngOnInit(): void {
        this.form = new UntypedFormGroup({
            href: new FormControl(this.existing ? this.existing.href : '', Validators.required),
            title: new FormControl(this.existing ? this.existing.title : ''),
            target: new FormControl(this.existing ? this.existing.target : null),
        });
    }

    remove() {
        this.resolveWith({
            title: '',
            href: '',
        });
    }

    select() {
        this.resolveWith(this.form.value);
    }
}
