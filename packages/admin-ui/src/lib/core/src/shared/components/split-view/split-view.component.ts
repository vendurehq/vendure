import {
    AfterContentInit,
    AfterViewInit,
    ChangeDetectionStrategy,
    Component,
    ContentChild,
    ElementRef,
    EventEmitter,
    Input,
    Output,
    TemplateRef,
    ViewChild,
    ViewContainerRef,
} from '@angular/core';
import { DomSanitizer, SafeStyle } from '@angular/platform-browser';
import { fromEvent, merge, Observable, switchMap } from 'rxjs';
import { map, mapTo, startWith, takeUntil } from 'rxjs/operators';
import { SplitViewLeftDirective, SplitViewRightDirective } from './split-view.directive';

@Component({
    selector: 'vdr-split-view',
    templateUrl: './split-view.component.html',
    styleUrls: ['./split-view.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class SplitViewComponent implements AfterContentInit, AfterViewInit {
    @Input() rightPanelOpen = false;
    @Output() closeClicked = new EventEmitter<void>();

    @ContentChild(SplitViewLeftDirective, { static: true, read: TemplateRef })
    leftTemplate: TemplateRef<any>;
    @ContentChild(SplitViewRightDirective, { static: true, read: SplitViewRightDirective })
    rightTemplate: SplitViewRightDirective;
    @ViewChild('resizeHandle', { static: true, read: ElementRef }) resizeHandle: ElementRef<HTMLDivElement>;
    protected rightPanelWidth$: Observable<number>;
    protected leftPanelWidth$: Observable<SafeStyle>;
    protected resizing$: Observable<boolean>;

    constructor(
        private viewContainerRef: ViewContainerRef,
        private domSanitizer: DomSanitizer,
    ) {}

    ngAfterContentInit(): void {
        if (!this.leftTemplate) {
            throw new Error('A <vdr-split-view-left> must be provided');
        }
        if (!this.rightTemplate) {
            throw new Error('A <vdr-split-view-right> must be provided');
        }
    }

    ngAfterViewInit() {
        const hostElement = this.viewContainerRef.element.nativeElement;
        const hostElementWidth = hostElement.getBoundingClientRect()?.width;

        const mouseDown$ = merge(
            fromEvent<MouseEvent>(this.resizeHandle.nativeElement, 'mousedown'),
            fromEvent<MouseEvent>(this.resizeHandle.nativeElement, 'touchstart'),
        );
        const mouseMove$ = merge(
            fromEvent<MouseEvent>(document, 'mousemove'),
            fromEvent<TouchEvent>(document, 'touchmove'),
        );
        const mouseUp$ = merge(
            fromEvent<MouseEvent>(document, 'mouseup'),
            fromEvent<TouchEvent>(document, 'touchend'),
        );

        // update right panel width when resize handle is dragged
        this.rightPanelWidth$ = mouseDown$.pipe(
            switchMap(() => mouseMove$.pipe(takeUntil(mouseUp$))),
            map(event => {
                const clientX = event instanceof MouseEvent ? event.clientX : event.touches[0].clientX;
                const width = hostElement.getBoundingClientRect().right - clientX;
                return Math.max(100, Math.min(width, hostElementWidth - 100));
            }),
            startWith(hostElementWidth / 2),
        );
        this.leftPanelWidth$ = this.rightPanelWidth$.pipe(
            map(width => `calc(var(--surface-width) - ${width}px)`),
        );

        this.resizing$ = merge(mouseDown$.pipe(mapTo(true)), mouseUp$.pipe(mapTo(false)));
    }

    close() {
        this.closeClicked.emit();
    }
}
