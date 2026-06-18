import { CdkDragEnd } from '@angular/cdk/drag-drop';
import {
    ChangeDetectionStrategy,
    Component,
    ElementRef,
    EventEmitter,
    HostBinding,
    Input,
    Output,
    ViewChild,
} from '@angular/core';

export type Point = { x: number; y: number };

@Component({
    selector: 'vdr-focal-point-control',
    templateUrl: './focal-point-control.component.html',
    styleUrls: ['./focal-point-control.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class FocalPointControlComponent {
    @Input() visible = false;
    @Input() editable = false;
    @HostBinding('style.width.px')
    @Input()
    width: number;
    @HostBinding('style.height.px')
    @Input()
    height: number;
    @Input() fpx = 0.5;
    @Input() fpy = 0.5;
    @Output() focalPointChange = new EventEmitter<Point>();

    @ViewChild('frame', { static: true }) frame: ElementRef<HTMLDivElement>;
    @ViewChild('dot', { static: true }) dot: ElementRef<HTMLDivElement>;

    get initialPosition(): Point {
        return this.focalPointToOffset(this.fpx == null ? 0.5 : this.fpx, this.fpy == null ? 0.5 : this.fpy);
    }

    onDragEnded(event: CdkDragEnd) {
        const { x, y } = this.getCurrentFocalPoint();
        this.fpx = x;
        this.fpy = y;
        this.focalPointChange.emit({ x, y });
    }

    private getCurrentFocalPoint(): Point {
        const { left: dotLeft, top: dotTop, width, height } = this.dot.nativeElement.getBoundingClientRect();
        const { left: frameLeft, top: frameTop } = this.frame.nativeElement.getBoundingClientRect();
        const xInPx = dotLeft - frameLeft + width / 2;
        const yInPx = dotTop - frameTop + height / 2;
        return {
            x: xInPx / this.width,
            y: yInPx / this.height,
        };
    }

    private focalPointToOffset(x: number, y: number): Point {
        const { width, height } = this.dot.nativeElement.getBoundingClientRect();
        return {
            x: x * this.width - width / 2,
            y: y * this.height - height / 2,
        };
    }
}
