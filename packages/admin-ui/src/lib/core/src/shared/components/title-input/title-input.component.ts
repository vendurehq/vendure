import { ChangeDetectionStrategy, Component, HostBinding, Input } from '@angular/core';

@Component({
    selector: 'vdr-title-input',
    templateUrl: './title-input.component.html',
    styleUrls: ['./title-input.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class TitleInputComponent {
    @HostBinding('class.readonly')
    @Input()
    readonly = false;
}
