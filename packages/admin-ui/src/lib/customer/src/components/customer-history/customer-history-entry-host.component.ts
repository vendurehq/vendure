import {
    Component,
    ComponentRef,
    EventEmitter,
    Input,
    OnDestroy,
    OnInit,
    Output,
    Type,
    ViewChild,
    ViewContainerRef,
} from '@angular/core';
import {
    CustomerFragment,
    CustomerHistoryEntryComponent,
    HistoryEntryComponentService,
    TimelineHistoryEntry,
} from '@vendure/admin-ui/core';

@Component({
    selector: 'vdr-customer-history-entry-host',
    template: `
        <vdr-timeline-entry
            [displayType]="instance.getDisplayType(entry)"
            [iconShape]="instance.getIconShape && instance.getIconShape(entry)"
            [createdAt]="entry.createdAt"
            [name]="instance.getName && instance.getName(entry)"
            [featured]="instance.isFeatured(entry)"
            [collapsed]="!expanded && !instance.isFeatured(entry)"
            (expandClick)="expandClick.emit()"
        >
            <div #portal></div>
        </vdr-timeline-entry>
    `,
    exportAs: 'historyEntry',
    standalone: false,
})
export class CustomerHistoryEntryHostComponent implements OnInit, OnDestroy {
    @Input() entry: TimelineHistoryEntry;
    @Input() customer: CustomerFragment;
    @Input() expanded: boolean;
    @Output() expandClick = new EventEmitter<void>();
    @ViewChild('portal', { static: true, read: ViewContainerRef }) portalRef: ViewContainerRef;
    instance: CustomerHistoryEntryComponent;
    private componentRef: ComponentRef<CustomerHistoryEntryComponent>;

    constructor(private historyEntryComponentService: HistoryEntryComponentService) {}

    ngOnInit(): void {
        const componentType = this.historyEntryComponentService.getComponent(
            this.entry.type,
        ) as Type<CustomerHistoryEntryComponent>;

        const componentRef = this.portalRef.createComponent(componentType);
        componentRef.instance.entry = this.entry;
        componentRef.instance.customer = this.customer;
        this.instance = componentRef.instance;
        this.componentRef = componentRef;
    }

    ngOnDestroy() {
        this.componentRef?.destroy();
    }
}
