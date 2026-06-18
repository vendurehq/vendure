import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';

import { Dialog, DialogButtonConfig } from '../../../providers/modal/modal.types';

/**
 * Used by ModalService.dialog() to host a generic configurable modal dialog.
 */
@Component({
    selector: 'vdr-simple-dialog',
    templateUrl: './simple-dialog.component.html',
    styleUrls: ['./simple-dialog.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class SimpleDialogComponent implements Dialog<any> {
    resolveWith: (result?: any) => void;
    title = '';
    body = '';
    translationVars = {};
    buttons: Array<DialogButtonConfig<any>> = [];
}
