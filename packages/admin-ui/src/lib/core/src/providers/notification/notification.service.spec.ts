import { Component, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, fakeAsync, TestBed, tick } from '@angular/core/testing';

import { TestingCommonModule } from '../../../../../testing/testing-common.module';
import { NotificationComponent } from '../../components/notification/notification.component';
import { OverlayHostComponent } from '../../components/overlay-host/overlay-host.component';
import { I18nService } from '../i18n/i18n.service';
import { MockI18nService } from '../i18n/i18n.service.mock';
import { OverlayHostService } from '../overlay-host/overlay-host.service';

import { NotificationService } from './notification.service';

describe('NotificationService:', () => {
    beforeEach(() => {
        TestBed.configureTestingModule({
            imports: [TestingCommonModule],
            declarations: [NotificationComponent, OverlayHostComponent, TestComponent],
            providers: [
                NotificationService,
                OverlayHostService,
                { provide: I18nService, useClass: MockI18nService },
            ],
            schemas: [CUSTOM_ELEMENTS_SCHEMA],
        });
    });

    describe('notification():', () => {
        // The ToastComponent relies heavily on async calls to schedule the dismissal of a notify.
        function runDismissTimers(): void {
            tick(5000); // duration timeout
            tick(2000); // fadeOut timeout
            tick(); // promise
            tick();
        }

        let fixture: ComponentFixture<TestComponent>;

        beforeEach(fakeAsync(() => {
            fixture = TestBed.createComponent(TestComponent);
            tick();
            fixture.detectChanges();
        }));

        it('should insert notify next to OverlayHost', fakeAsync(() => {
            const instance: TestComponent = fixture.componentInstance;

            instance.notificationService.notify({ message: 'test' });
            fixture.detectChanges();
            tick();

            expect(fixture.nativeElement.querySelector('vdr-notification')).not.toBeNull();
            runDismissTimers();
        }));

        it('should bind the message', fakeAsync(() => {
            const instance: TestComponent = fixture.componentInstance;

            instance.notificationService.notify({ message: 'test' });
            tick();
            fixture.detectChanges();

            expect(fixture.nativeElement.querySelector('.notification-wrapper').innerHTML).toContain('test');
            runDismissTimers();
        }));

        it('should dismiss after duration elapses', fakeAsync(() => {
            const instance: TestComponent = fixture.componentInstance;

            instance.notificationService.notify({
                message: 'test',
                duration: 1000,
            });
            tick();
            fixture.detectChanges();
            expect(fixture.nativeElement.querySelector('vdr-notification')).not.toBeNull();

            runDismissTimers();

            expect(fixture.nativeElement.querySelector('vdr-notification')).toBeNull();
        }));
    });
});

@Component({
    template: `
        <vdr-overlay-host></vdr-overlay-host>
    `,
    standalone: false,
})
class TestComponent {
    constructor(public notificationService: NotificationService) {}
}
