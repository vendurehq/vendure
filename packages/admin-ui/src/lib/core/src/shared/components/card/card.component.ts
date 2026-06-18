import {
    ChangeDetectionStrategy,
    Component,
    ContentChild,
    Directive,
    Input,
    TemplateRef,
} from '@angular/core';

@Directive({
    selector: '[vdrCardControls]',
    standalone: false,
})
export class CardControlsDirective {}

@Component({
    selector: 'vdr-card',
    templateUrl: './card.component.html',
    styleUrls: ['./card.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class CardComponent {
    @Input() title: string;
    @Input() paddingX = true;
    @ContentChild(CardControlsDirective, { read: TemplateRef }) controlsTemplate: TemplateRef<any>;
}
