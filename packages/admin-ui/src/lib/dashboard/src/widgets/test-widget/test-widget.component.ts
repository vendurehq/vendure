import { ChangeDetectionStrategy, Component, NgModule } from '@angular/core';

@Component({
    selector: 'vdr-test-widget',
    templateUrl: './test-widget.component.html',
    styleUrls: ['./test-widget.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class TestWidgetComponent {}

@NgModule({
    declarations: [TestWidgetComponent],
})
export class TestWidgetModule {}
