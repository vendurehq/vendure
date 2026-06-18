import {
    EventEmitter,
    ChangeDetectionStrategy,
    Component,
    ContentChild,
    Directive,
    Input,
    Output,
    TemplateRef,
} from '@angular/core';

@Directive({
    selector: '[vdrRelationCardPreview]',
    standalone: false,
})
export class RelationCardPreviewDirective {}
@Directive({
    selector: '[vdrRelationCardDetail]',
    standalone: false,
})
export class RelationCardDetailDirective {}

@Component({
    selector: 'vdr-relation-card',
    templateUrl: './relation-card.component.html',
    styleUrls: ['./relation-card.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class RelationCardComponent {
    @Input() entity: any;
    @Input() placeholderIcon: string;
    @Input() selectLabel: string;
    @Input() readonly: boolean;
    @Input() removable = true;
    // eslint-disable-next-line @angular-eslint/no-output-native
    @Output() select = new EventEmitter();
    @Output() remove = new EventEmitter();
    @ContentChild(RelationCardPreviewDirective, { read: TemplateRef })
    previewTemplate: TemplateRef<any>;
    @ContentChild(RelationCardDetailDirective, { read: TemplateRef })
    detailTemplate: TemplateRef<any>;
}
