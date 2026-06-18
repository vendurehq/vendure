/* eslint-disable @angular-eslint/component-class-suffix */
import { Component, Input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { map } from 'rxjs/operators';

import { DataService } from '../../data/providers/data.service';

import { IfMultichannelDirective } from './if-multichannel.directive';

describe('vdrIfMultichannel directive', () => {
    describe('simple usage', () => {
        let fixture: ComponentFixture<TestComponentSimple>;

        beforeEach(() => {
            fixture = TestBed.configureTestingModule({
                declarations: [TestComponentSimple, IfMultichannelDirective],
                providers: [{ provide: DataService, useClass: MockDataService }],
            }).createComponent(TestComponentSimple);
            fixture.detectChanges(); // initial binding
        });

        it('is multichannel', () => {
            (fixture.componentInstance.dataService as unknown as MockDataService).setChannels([1, 2]);
            fixture.detectChanges();

            const thenEl = fixture.nativeElement.querySelector('.then');
            expect(thenEl).not.toBeNull();
        });

        it('not multichannel', () => {
            (fixture.componentInstance.dataService as unknown as MockDataService).setChannels([1]);
            fixture.detectChanges();

            const thenEl = fixture.nativeElement.querySelector('.then');
            expect(thenEl).toBeNull();
        });
    });

    describe('if-else usage', () => {
        let fixture: ComponentFixture<TestComponentIfElse>;

        beforeEach(() => {
            fixture = TestBed.configureTestingModule({
                declarations: [TestComponentIfElse, IfMultichannelDirective],
                providers: [{ provide: DataService, useClass: MockDataService }],
            }).createComponent(TestComponentIfElse);
            fixture.detectChanges(); // initial binding
        });

        it('is multichannel', () => {
            (fixture.componentInstance.dataService as unknown as MockDataService).setChannels([1, 2]);
            fixture.detectChanges();

            const thenEl = fixture.nativeElement.querySelector('.then');
            expect(thenEl).not.toBeNull();
            const elseEl = fixture.nativeElement.querySelector('.else');
            expect(elseEl).toBeNull();
        });

        it('not multichannel', () => {
            (fixture.componentInstance.dataService as unknown as MockDataService).setChannels([1]);
            fixture.detectChanges();

            const thenEl = fixture.nativeElement.querySelector('.then');
            expect(thenEl).toBeNull();
            const elseEl = fixture.nativeElement.querySelector('.else');
            expect(elseEl).not.toBeNull();
        });
    });
});

@Component({
    template: `
        <div *vdrIfMultichannel>
            <span class="then"></span>
        </div>
    `,
    standalone: false,
})
export class TestComponentSimple {
    constructor(public dataService: DataService) {}
    @Input() permissionToTest = '';
}

@Component({
    template: `
        <ng-template vdrIfMultichannel [vdrIfMultichannelElse]="not">
            <span class="then"></span>
        </ng-template>
        <ng-template #not><span class="else"></span></ng-template>
    `,
    standalone: false,
})
export class TestComponentIfElse {
    constructor(public dataService: DataService) {}
    @Input() permissionToTest = '';
}

class MockDataService {
    private channels$ = new BehaviorSubject<any[]>([]);
    setChannels(channels: any[]) {
        this.channels$.next(channels);
    }
    client = {
        userStatus: () => ({
            mapStream: (mapFn: any) =>
                this.channels$.pipe(
                    map(channels =>
                        mapFn({
                            userStatus: {
                                channels,
                            },
                        }),
                    ),
                ),
        }),
    };
}
