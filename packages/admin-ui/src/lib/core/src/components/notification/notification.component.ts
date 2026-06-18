import { Component, ElementRef, HostListener, OnInit, ViewChild } from '@angular/core';

import { NotificationType } from '../../providers/notification/notification.service';

import {
    LocalizationDirectionType,
    LocalizationService,
} from '../../providers/localization/localization.service';

@Component({
    selector: 'vdr-notification',
    templateUrl: './notification.component.html',
    styleUrls: ['./notification.component.scss'],
    standalone: false,
})
export class NotificationComponent implements OnInit {
    direction$: LocalizationDirectionType;

    @ViewChild('wrapper', { static: true }) wrapper: ElementRef;
    offsetTop = 0;
    message = '';
    translationVars: { [key: string]: string | number } = {};
    type: NotificationType = 'info';
    isVisible = true;
    private onClickFn: () => void = () => {
        /* */
    };

    /**
     *
     */
    constructor(private localizationService: LocalizationService) {}

    ngOnInit(): void {
        this.direction$ = this.localizationService.direction$;
    }

    registerOnClickFn(fn: () => void): void {
        this.onClickFn = fn;
    }

    @HostListener('click')
    onClick(): void {
        if (this.isVisible) {
            this.onClickFn();
        }
    }

    /**
     * Fade out the toast. When promise resolves, toast is invisible and
     * can be removed.
     */
    fadeOut(): Promise<any> {
        this.isVisible = false;
        return new Promise(resolve => setTimeout(resolve, 1000));
    }

    /**
     * Returns the height of the toast element in px.
     */
    getHeight(): number {
        if (!this.wrapper) {
            return 0;
        }
        const el: HTMLElement = this.wrapper.nativeElement;
        return el.getBoundingClientRect().height;
    }

    getIcon(): string {
        switch (this.type) {
            case 'info':
                return 'info-circle';
            case 'success':
                return 'check-circle';
            case 'error':
                return 'exclamation-circle';
            case 'warning':
                return 'exclamation-triangle';
        }
    }

    stringifyMessage(message: unknown) {
        if (typeof message === 'string') {
            return message;
        } else {
            return JSON.stringify(message, null, 2);
        }
    }
}
