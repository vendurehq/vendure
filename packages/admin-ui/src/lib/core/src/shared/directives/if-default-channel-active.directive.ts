import { ChangeDetectorRef, Directive, Input, TemplateRef, ViewContainerRef } from '@angular/core';
import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import { tap } from 'rxjs/operators';

import { UserStatus } from '../../common/generated-types';
import { DataService } from '../../data/providers/data.service';

import { IfDirectiveBase } from './if-directive-base';

@Directive({
    selector: '[vdrIfDefaultChannelActive]',
    standalone: false,
})
export class IfDefaultChannelActiveDirective extends IfDirectiveBase<[]> {
    constructor(
        _viewContainer: ViewContainerRef,
        templateRef: TemplateRef<any>,
        private dataService: DataService,
        private changeDetectorRef: ChangeDetectorRef,
    ) {
        super(_viewContainer, templateRef, () =>
            this.dataService.client
                .userStatus()
                .mapStream(({ userStatus }) => this.defaultChannelIsActive(userStatus))
                .pipe(tap(() => this.changeDetectorRef.markForCheck())),
        );
    }

    /**
     * A template to show if the current user does not have the specified permission.
     */
    @Input()
    set vdrIfMultichannelElse(templateRef: TemplateRef<any> | null) {
        this.setElseTemplate(templateRef);
    }

    private defaultChannelIsActive(userStatus: UserStatus): boolean {
        const defaultChannel = userStatus.channels.find(c => c.code === DEFAULT_CHANNEL_CODE);

        return !!(defaultChannel && userStatus.activeChannelId === defaultChannel.id);
    }
}
