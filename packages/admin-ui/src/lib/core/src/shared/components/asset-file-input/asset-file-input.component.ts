import {
    ChangeDetectionStrategy,
    Component,
    EventEmitter,
    HostListener,
    Input,
    OnInit,
    Output,
} from '@angular/core';
import { notNullOrUndefined } from '@vendure/common/lib/shared-utils';

import { ServerConfigService } from '../../../data/server-config';

/**
 * A component for selecting files to upload as new Assets.
 */
@Component({
    selector: 'vdr-asset-file-input',
    templateUrl: './asset-file-input.component.html',
    styleUrls: ['./asset-file-input.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class AssetFileInputComponent implements OnInit {
    /**
     * CSS selector of the DOM element which will be masked by the file
     * drop zone. Defaults to `body`.
     */
    @Input() dropZoneTarget = 'body';
    @Input() uploading = false;
    @Output() selectFiles = new EventEmitter<File[]>();
    dragging = false;
    overDropZone = false;
    dropZoneStyle = {
        'width.px': 0,
        'height.px': 0,
        'top.px': 0,
        'left.px': 0,
    };
    accept: string;

    constructor(private serverConfig: ServerConfigService) {}

    ngOnInit() {
        this.accept = this.serverConfig.serverConfig.permittedAssetTypes.join(',');
        this.fitDropZoneToTarget();
    }

    @HostListener('document:dragenter')
    onDragEnter() {
        this.dragging = true;
        this.fitDropZoneToTarget();
    }

    // DragEvent is not supported in Safari, see https://github.com/vendurehq/vendure/pull/284
    @HostListener('document:dragleave', ['$event'])
    onDragLeave(event: any) {
        if (!event.clientX && !event.clientY) {
            this.dragging = false;
        }
    }

    /**
     * Preventing this event is required to make dropping work.
     * See https://developer.mozilla.org/en-US/docs/Web/API/HTML_Drag_and_Drop_API#Define_a_drop_zone
     */
    onDragOver(event: any) {
        event.preventDefault();
    }

    // DragEvent is not supported in Safari, see https://github.com/vendurehq/vendure/pull/284
    onDrop(event: any) {
        event.preventDefault();
        this.dragging = false;
        this.overDropZone = false;
        const files = Array.from<DataTransferItem>(event.dataTransfer ? event.dataTransfer.items : [])
            .map(i => i.getAsFile())
            .filter(notNullOrUndefined);
        this.selectFiles.emit(files);
    }

    select(event: Event) {
        const files = (event.target as HTMLInputElement).files;
        if (files) {
            this.selectFiles.emit(Array.from(files));
        }
    }

    private fitDropZoneToTarget() {
        const target = document.querySelector(this.dropZoneTarget) as HTMLElement;
        if (target) {
            const rect = target.getBoundingClientRect();
            this.dropZoneStyle['width.px'] = rect.width;
            this.dropZoneStyle['height.px'] = rect.height;
            this.dropZoneStyle['top.px'] = rect.top;
            this.dropZoneStyle['left.px'] = rect.left;
        }
    }
}
