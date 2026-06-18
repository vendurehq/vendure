import {
    AfterViewInit,
    ChangeDetectionStrategy,
    ChangeDetectorRef,
    Component,
    ElementRef,
    HostBinding,
    Input,
    OnDestroy,
    ViewChild,
    ViewContainerRef,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

import { ContextMenuService } from './prosemirror/context-menu/context-menu.service';
import { ProsemirrorService } from './prosemirror/prosemirror.service';

/**
 * @description
 * A rich text (HTML) editor based on Prosemirror (https://prosemirror.net/)
 *
 * @example
 * ```HTML
 * <vdr-rich-text-editor
 *     [(ngModel)]="description"
 *     label="Description"
 * ></vdr-rich-text-editor>
 * ```
 *
 * @docsCategory components
 */
@Component({
    selector: 'vdr-rich-text-editor',
    templateUrl: './rich-text-editor.component.html',
    styleUrls: ['./rich-text-editor.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    providers: [
        {
            provide: NG_VALUE_ACCESSOR,
            useExisting: RichTextEditorComponent,
            multi: true,
        },
        ProsemirrorService,
        ContextMenuService,
    ],
    standalone: false,
})
export class RichTextEditorComponent implements ControlValueAccessor, AfterViewInit, OnDestroy {
    @Input() label: string;
    @Input() set readonly(value: any) {
        this._readonly = !!value;
        this.prosemirrorService.setEnabled(!this._readonly);
    }
    @HostBinding('class.readonly')
    _readonly = false;

    onChange: (val: any) => void;
    onTouch: () => void;
    private value: string;

    @ViewChild('editor', { static: true }) private editorEl: ElementRef<HTMLDivElement>;

    constructor(
        private changeDetector: ChangeDetectorRef,
        private prosemirrorService: ProsemirrorService,
        private viewContainerRef: ViewContainerRef,
        public contextMenuService: ContextMenuService,
    ) {}

    get menuElement(): HTMLDivElement | null {
        return this.viewContainerRef.element.nativeElement.querySelector('.ProseMirror-menubar');
    }

    ngAfterViewInit() {
        this.prosemirrorService.createEditorView({
            element: this.editorEl.nativeElement,
            onTextInput: content => {
                this.onChange(content);
                this.changeDetector.markForCheck();
            },
            isReadOnly: () => !this._readonly,
        });
        if (this.value) {
            this.prosemirrorService.update(this.value);
        }
    }

    ngOnDestroy() {
        this.prosemirrorService.destroy();
    }

    registerOnChange(fn: any) {
        this.onChange = fn;
    }

    registerOnTouched(fn: any) {
        this.onTouch = fn;
    }

    setDisabledState(isDisabled: boolean) {
        this.prosemirrorService.setEnabled(!isDisabled);
    }

    writeValue(value: any) {
        if (value !== this.value) {
            this.value = value;
            if (this.prosemirrorService) {
                this.prosemirrorService.update(value);
            }
        }
    }
}
