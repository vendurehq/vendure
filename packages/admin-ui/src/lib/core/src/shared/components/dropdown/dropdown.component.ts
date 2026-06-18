import { ChangeDetectionStrategy, Component, ElementRef, Input } from '@angular/core';

/**
 * @description
 * Used for building dropdown menus.
 *
 * @example
 * ```HTML
 * <vdr-dropdown>
 *   <button class="btn btn-outline" vdrDropdownTrigger>
 *       <clr-icon shape="plus"></clr-icon>
 *       Select type
 *   </button>
 *   <vdr-dropdown-menu vdrPosition="bottom-left">
 *     <button
 *       *ngFor="let typeName of allTypes"
 *       type="button"
 *       vdrDropdownItem
 *       (click)="selectType(typeName)"
 *     >
 *       typeName
 *     </button>
 *   </vdr-dropdown-menu>
 * </vdr-dropdown>
 * ```
 * @docsCategory components
 */
@Component({
    selector: 'vdr-dropdown',
    templateUrl: './dropdown.component.html',
    styleUrls: ['./dropdown.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class DropdownComponent {
    isOpen = false;
    private onOpenChangeCallbacks: Array<(isOpen: boolean) => void> = [];
    public trigger: ElementRef;
    @Input() manualToggle = false;

    onClick() {
        if (!this.manualToggle) {
            this.toggleOpen();
        }
    }

    toggleOpen() {
        this.isOpen = !this.isOpen;
        this.onOpenChangeCallbacks.forEach(fn => fn(this.isOpen));
    }

    onOpenChange(callback: (isOpen: boolean) => void) {
        this.onOpenChangeCallbacks.push(callback);
    }

    setTriggerElement(elementRef: ElementRef) {
        this.trigger = elementRef;
    }
}
