import { ConnectedPosition, Overlay, OverlayRef, PositionStrategy } from '@angular/cdk/overlay';
import { TemplatePortal } from '@angular/cdk/portal';
import {
    AfterViewInit,
    ChangeDetectionStrategy,
    ChangeDetectorRef,
    Component,
    HostListener,
    Input,
    OnDestroy,
    OnInit,
    TemplateRef,
    ViewChild,
    ViewContainerRef,
} from '@angular/core';
import { Subscription } from 'rxjs';

import {
    LocalizationDirectionType,
    LocalizationService,
} from '../../../providers/localization/localization.service';
import { DropdownComponent } from './dropdown.component';

export type DropdownPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/**
 * A dropdown menu modelled on the Clarity Dropdown component (https://v1.clarity.design/dropdowns).
 *
 * This was created because the Clarity implementation (at this time) does not handle edge detection. Instead
 * we make use of the Angular CDK's Overlay module to manage the positioning.
 *
 * The API of this component (and its related Components & Directives) are based on the Clarity version,
 * albeit only a subset which is currently used in this application.
 */
@Component({
    selector: 'vdr-dropdown-menu',
    template: `
        <ng-template #menu>
            <div [dir]="direction$ | async">
                <div class="dropdown open">
                    <div class="dropdown-menu" [ngClass]="customClasses" [style.maxHeight.px]="maxHeight">
                        <div
                            class="dropdown-content-wrapper"
                            [cdkTrapFocus]="true"
                            [cdkTrapFocusAutoCapture]="true"
                        >
                            <ng-content></ng-content>
                        </div>
                    </div>
                </div>
            </div>
        </ng-template>
    `,
    styleUrls: ['./dropdown-menu.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class DropdownMenuComponent implements AfterViewInit, OnInit, OnDestroy {
    direction$: LocalizationDirectionType;

    @Input('vdrPosition') private position: DropdownPosition = 'bottom-left';
    @Input() customClasses: string;
    @ViewChild('menu', { static: true }) private menuTemplate: TemplateRef<any>;
    private menuPortal: TemplatePortal;
    private overlayRef: OverlayRef;
    private backdropClickSub: Subscription;
    protected maxHeight: number | undefined;

    private resizeObserver = new ResizeObserver(entries => {
        const margin = 12;
        for (const entry of entries) {
            const contentWrapper = entry.target.querySelector('.dropdown-content-wrapper');
            if (contentWrapper) {
                const { bottom, top } = contentWrapper?.getBoundingClientRect();
                if (bottom > window.innerHeight - margin) {
                    // dropdown is going off the bottom of the screen
                    this.maxHeight = window.innerHeight - top - margin;
                    this.changeDetector.markForCheck();
                }
                if (top < margin) {
                    // dropdown is going off the top of the screen
                    this.maxHeight = bottom - margin;
                    this.changeDetector.markForCheck();
                }
            }
        }
    });

    @HostListener('window:keydown.escape', ['$event'])
    onEscapeKeydown(event: KeyboardEvent) {
        if (this.dropdown.isOpen) {
            if (this.overlayRef.overlayElement.contains(document.activeElement)) {
                this.dropdown.toggleOpen();
            }
        }
    }

    @HostListener('window:keydown', ['$event'])
    onArrowKey(event: KeyboardEvent) {
        if (
            this.dropdown.isOpen &&
            document.activeElement instanceof HTMLElement &&
            (event.key === 'ArrowDown' || event.key === 'ArrowUp')
        ) {
            const dropdownItems = Array.from(
                this.overlayRef.overlayElement.querySelectorAll<HTMLElement>('.dropdown-item'),
            );
            const currentIndex = dropdownItems.indexOf(document.activeElement);
            if (currentIndex === -1) {
                return;
            }
            if (event.key === 'ArrowDown') {
                const nextItem = dropdownItems[(currentIndex + 1) % dropdownItems.length];
                nextItem.focus();
            }
            if (event.key === 'ArrowUp') {
                const previousItem =
                    dropdownItems[(currentIndex - 1 + dropdownItems.length) % dropdownItems.length];
                previousItem.focus();
            }
        }
    }

    constructor(
        private overlay: Overlay,
        private viewContainerRef: ViewContainerRef,
        private dropdown: DropdownComponent,
        private localizationService: LocalizationService,
        private changeDetector: ChangeDetectorRef,
    ) {}

    ngOnInit(): void {
        this.direction$ = this.localizationService.direction$;

        this.dropdown.onOpenChange(isOpen => {
            if (isOpen) {
                this.overlayRef.attach(this.menuPortal);
                this.resizeObserver.observe(this.overlayRef.overlayElement);
            } else {
                this.overlayRef.detach();
                this.resizeObserver.unobserve(this.overlayRef.overlayElement);
                this.maxHeight = undefined;
            }
        });
    }

    ngAfterViewInit() {
        this.overlayRef = this.overlay.create({
            hasBackdrop: true,
            backdropClass: 'clear-backdrop',
            positionStrategy: this.getPositionStrategy(),
            maxHeight: '70vh',
        });

        this.menuPortal = new TemplatePortal(this.menuTemplate, this.viewContainerRef);
        this.backdropClickSub = this.overlayRef.backdropClick().subscribe(() => {
            this.dropdown.toggleOpen();
        });
    }

    ngOnDestroy(): void {
        if (this.overlayRef) {
            this.overlayRef.dispose();
        }
        if (this.backdropClickSub) {
            this.backdropClickSub.unsubscribe();
        }
    }

    private getPositionStrategy(): PositionStrategy {
        const position: { [K in DropdownPosition]: ConnectedPosition } = {
            ['top-left']: {
                originX: 'start',
                originY: 'top',
                overlayX: 'start',
                overlayY: 'bottom',
            },
            ['top-right']: {
                originX: 'end',
                originY: 'top',
                overlayX: 'end',
                overlayY: 'bottom',
            },
            ['bottom-left']: {
                originX: 'start',
                originY: 'bottom',
                overlayX: 'start',
                overlayY: 'top',
            },
            ['bottom-right']: {
                originX: 'end',
                originY: 'bottom',
                overlayX: 'end',
                overlayY: 'top',
            },
        };

        const pos = position[this.position];

        return this.overlay
            .position()
            .flexibleConnectedTo(this.dropdown.trigger)
            .withPositions([pos, this.invertPosition(pos)])
            .withViewportMargin(12)
            .withPush(true);
    }

    /** Inverts an overlay position. */
    private invertPosition(pos: ConnectedPosition): ConnectedPosition {
        const inverted = { ...pos };
        inverted.originY = pos.originY === 'top' ? 'bottom' : 'top';
        inverted.overlayY = pos.overlayY === 'top' ? 'bottom' : 'top';

        return inverted;
    }
}
