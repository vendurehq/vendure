import { Directive, Input, TemplateRef, ViewContainerRef } from '@angular/core';

import { DataService } from '../../data/providers/data.service';

import { IfDirectiveBase } from './if-directive-base';

/**
 * @description
 * Structural directive that displays the given element if the Vendure instance has multiple channels
 * configured.
 *
 * @example
 * ```html
 * <div *vdrIfMultichannel class="channel-selector">
 *   <!-- ... -->
 * </ng-container>
 * ```
 *
 * @docsCategory directives
 */
@Directive({
    selector: '[vdrIfMultichannel]',
    standalone: false,
})
export class IfMultichannelDirective extends IfDirectiveBase<[]> {
    constructor(
        _viewContainer: ViewContainerRef,
        templateRef: TemplateRef<any>,
        private dataService: DataService,
    ) {
        super(_viewContainer, templateRef, () =>
            this.dataService.client
                .userStatus()
                .mapStream(({ userStatus }) => 1 < userStatus.channels.length),
        );
    }

    /**
     * A template to show if the current user does not have the specified permission.
     */
    @Input()
    set vdrIfMultichannelElse(templateRef: TemplateRef<any> | null) {
        this.setElseTemplate(templateRef);
    }
}
