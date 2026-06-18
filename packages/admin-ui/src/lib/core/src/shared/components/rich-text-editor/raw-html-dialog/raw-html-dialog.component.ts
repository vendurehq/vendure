import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { UntypedFormControl } from '@angular/forms';

import { ConfigArgDefinition } from '../../../../common/generated-types';
import { Dialog } from '../../../../providers/modal/modal.types';
import { HtmlEditorFormInputComponent } from '../../../dynamic-form-inputs/code-editor-form-input/html-editor-form-input.component';

@Component({
    selector: 'vdr-raw-html-dialog',
    templateUrl: './raw-html-dialog.component.html',
    styleUrls: ['./raw-html-dialog.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class RawHtmlDialogComponent implements OnInit, Dialog<string> {
    html: string;
    formControl = new UntypedFormControl();
    config: ConfigArgDefinition = {
        name: '',
        type: '',
        list: false,
        required: true,
        ui: { component: HtmlEditorFormInputComponent.id },
    };

    resolveWith: (html: string | undefined) => void;

    ngOnInit(): void {
        this.formControl.setValue(this.process(this.html));
    }

    process(str: string) {
        const div = document.createElement('div');
        div.innerHTML = str.trim();
        return this.format(div, 0).innerHTML.trim();
    }

    /**
     * Taken from https://stackoverflow.com/a/26361620/772859
     */
    format(node: Element, level = 0) {
        const indentBefore = new Array(level++ + 1).join('\t');
        const indentAfter = new Array(level - 1).join('\t');
        let textNode: Text;

        // eslint-disable-next-line @typescript-eslint/prefer-for-of
        for (let i = 0; i < node.children.length; i++) {
            textNode = document.createTextNode('\n' + indentBefore);
            node.insertBefore(textNode, node.children[i]);

            this.format(node.children[i], level);

            if (node.lastElementChild === node.children[i]) {
                textNode = document.createTextNode('\n' + indentAfter);
                node.appendChild(textNode);
            }
        }

        return node;
    }

    cancel() {
        this.resolveWith(undefined);
    }

    select() {
        this.resolveWith(this.formControl.value);
    }
}
