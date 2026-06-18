import {
    AfterViewInit,
    ChangeDetectionStrategy,
    Component,
    ElementRef,
    OnDestroy,
    OnInit,
    ViewChild,
} from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { SharedModule } from '../../shared.module';

import { ExtensionHostConfig } from './extension-host-config';
import { ExtensionHostService } from './extension-host.service';

/**
 * This component uses an iframe to embed an external url into the Admin UI, and uses the PostMessage
 * protocol to allow cross-frame communication between the two frames.
 */
@Component({
    selector: 'vdr-extension-host',
    templateUrl: './extension-host.component.html',
    styleUrls: ['./extension-host.component.scss'],
    changeDetection: ChangeDetectionStrategy.Default,
    imports: [SharedModule],
    providers: [ExtensionHostService],
})
export class ExtensionHostComponent implements OnInit, AfterViewInit, OnDestroy {
    extensionUrl: SafeResourceUrl;
    openInIframe = true;
    extensionWindowIsOpen = false;
    private config: ExtensionHostConfig;
    private extensionWindow?: Window;
    @ViewChild('extensionFrame') private extensionFrame: ElementRef<HTMLIFrameElement>;

    constructor(
        private route: ActivatedRoute,
        private sanitizer: DomSanitizer,
        private extensionHostService: ExtensionHostService,
    ) {}

    ngOnInit() {
        const { data } = this.route.snapshot;
        if (!this.isExtensionHostConfig(data.extensionHostConfig)) {
            throw new Error(
                `Expected an ExtensionHostConfig object, got ${JSON.stringify(data.extensionHostConfig)}`,
            );
        }
        this.config = data.extensionHostConfig;
        this.openInIframe = !this.config.openInNewTab;
        this.extensionUrl = this.sanitizer.bypassSecurityTrustResourceUrl(
            this.config.extensionUrl || 'about:blank',
        );
    }

    ngAfterViewInit() {
        if (this.openInIframe) {
            const extensionWindow = this.extensionFrame.nativeElement.contentWindow;
            if (extensionWindow) {
                this.extensionHostService.init(extensionWindow, this.route.snapshot);
            }
        }
    }

    ngOnDestroy(): void {
        if (this.extensionWindow) {
            this.extensionWindow.close();
        }
    }

    launchExtensionWindow() {
        const extensionWindow = window.open(this.config.extensionUrl);
        if (!extensionWindow) {
            return;
        }
        this.extensionHostService.init(extensionWindow, this.route.snapshot);
        this.extensionWindowIsOpen = true;
        this.extensionWindow = extensionWindow;

        let timer: number;
        function pollWindowState(extwindow: Window, onClosed: () => void) {
            if (extwindow.closed) {
                window.clearTimeout(timer);
                onClosed();
            } else {
                timer = window.setTimeout(() => pollWindowState(extwindow, onClosed), 250);
            }
        }

        pollWindowState(extensionWindow, () => {
            this.extensionWindowIsOpen = false;
            this.extensionHostService.destroy();
        });
    }

    private isExtensionHostConfig(input: any): input is ExtensionHostConfig {
        return input.hasOwnProperty('extensionUrl');
    }
}
