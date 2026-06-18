import { ComponentFactoryResolver, ComponentRef, Injectable, ViewContainerRef } from '@angular/core';

import { NotificationComponent } from '../../components/notification/notification.component';
import { I18nService } from '../i18n/i18n.service';
import { OverlayHostService } from '../overlay-host/overlay-host.service';

/**
 * @description
 * The types of notification available.
 *
 * @docsCategory services
 * @docsPage NotificationService
 */
export type NotificationType = 'info' | 'success' | 'error' | 'warning';

/**
 * @description
 * Configuration for a toast notification.
 *
 * @docsCategory services
 * @docsPage NotificationService
 */
export interface ToastConfig {
    message: string;
    translationVars?: { [key: string]: string | number };
    type?: NotificationType;
    duration?: number;
}

// How many ms before the toast is dismissed.
const TOAST_DURATION = 3000;

/**
 * @description
 * Provides toast notification functionality.
 *
 * @example
 * ```ts
 * class MyComponent {
 *   constructor(private notificationService: NotificationService) {}
 *
 *   save() {
 *     this.notificationService
 *         .success(_('asset.notify-create-assets-success'), {
 *           count: successCount,
 *         });
 *   }
 * }
 *
 * @docsCategory services
 * @docsPage NotificationService
 * @docsWeight 0
 */
@Injectable({
    providedIn: 'root',
})
export class NotificationService {
    private get hostView(): Promise<ViewContainerRef> {
        return this.overlayHostService.getHostView();
    }

    private openToastRefs: Array<{ ref: ComponentRef<NotificationComponent>; timerId: any }> = [];

    constructor(
        private i18nService: I18nService,
        private resolver: ComponentFactoryResolver,
        private overlayHostService: OverlayHostService,
    ) {}

    /**
     * @description
     * Display a success toast notification
     */
    success(message: string, translationVars?: { [key: string]: string | number }): void {
        this.notify({
            message,
            translationVars,
            type: 'success',
        });
    }

    /**
     * @description
     * Display an info toast notification
     */
    info(message: string, translationVars?: { [key: string]: string | number }): void {
        this.notify({
            message,
            translationVars,
            type: 'info',
        });
    }

    /**
     * @description
     * Display a warning toast notification
     */
    warning(message: string, translationVars?: { [key: string]: string | number }): void {
        this.notify({
            message,
            translationVars,
            type: 'warning',
        });
    }

    /**
     * @description
     * Display an error toast notification
     */
    error(message: string, translationVars?: { [key: string]: string | number }): void {
        this.notify({
            message,
            translationVars,
            type: 'error',
            duration: 20000,
        });
    }

    /**
     * @description
     * Display a toast notification.
     */
    notify(config: ToastConfig): void {
        this.createToast(config);
    }

    /**
     * Load a ToastComponent into the DOM host location.
     */
    private async createToast(config: ToastConfig): Promise<void> {
        const toastFactory = this.resolver.resolveComponentFactory(NotificationComponent);
        const hostView = await this.hostView;
        const ref = hostView.createComponent<NotificationComponent>(toastFactory);
        const toast: NotificationComponent = ref.instance;
        const dismissFn = this.createDismissFunction(ref);
        toast.type = config.type || 'info';
        toast.message = config.message;
        toast.translationVars = this.translateTranslationVars(config.translationVars || {});
        toast.registerOnClickFn(dismissFn);

        let timerId;
        if (!config.duration || 0 < config.duration) {
            timerId = setTimeout(dismissFn, config.duration || TOAST_DURATION);
        }

        this.openToastRefs.unshift({ ref, timerId });
        setTimeout(() => this.calculatePositions());
    }

    /**
     * Returns a function which will destroy the toast component and
     * remove it from the openToastRefs array.
     */
    private createDismissFunction(ref: ComponentRef<NotificationComponent>): () => void {
        return () => {
            const toast: NotificationComponent = ref.instance;
            const index = this.openToastRefs.map(o => o.ref).indexOf(ref);

            if (this.openToastRefs[index]) {
                clearTimeout(this.openToastRefs[index].timerId);
            }

            toast.fadeOut().then(() => {
                ref.destroy();
                this.openToastRefs.splice(index, 1);
                this.calculatePositions();
            });
        };
    }

    /**
     * Calculate and set the top offsets for each of the open toasts.
     */
    private calculatePositions(): void {
        let cumulativeHeight = 10;

        this.openToastRefs.forEach(obj => {
            const toast: NotificationComponent = obj.ref.instance;
            toast.offsetTop = cumulativeHeight;
            cumulativeHeight += toast.getHeight() + 6;
        });
    }

    private translateTranslationVars(translationVars: { [key: string]: string | number }): {
        [key: string]: string | number;
    } {
        for (const [key, val] of Object.entries(translationVars)) {
            if (typeof val === 'string') {
                translationVars[key] = this.i18nService.translate(val);
            }
        }
        return translationVars;
    }
}
