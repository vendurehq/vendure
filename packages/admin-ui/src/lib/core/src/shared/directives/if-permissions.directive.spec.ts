import { Component, Input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PermissionsService } from '../../providers/permissions/permissions.service';

import { IfPermissionsDirective } from './if-permissions.directive';

describe('vdrIfPermissions directive', () => {
    let fixture: ComponentFixture<TestComponent>;

    beforeEach(() => {
        fixture = TestBed.configureTestingModule({
            declarations: [TestComponent, IfPermissionsDirective],
        }).createComponent(TestComponent);
        fixture.detectChanges(); // initial binding

        TestBed.inject(PermissionsService).setCurrentUserPermissions(['ValidPermission']);
    });

    it('has permission (single)', () => {
        fixture.componentInstance.permissionToTest = 'ValidPermission';
        fixture.detectChanges();

        const thenEl = fixture.nativeElement.querySelector('.then');
        expect(thenEl).not.toBeNull();
        const elseEl = fixture.nativeElement.querySelector('.else');
        expect(elseEl).toBeNull();
    });

    it('has permission (array all match)', () => {
        fixture.componentInstance.permissionToTest = ['ValidPermission'];
        fixture.detectChanges();

        const thenEl = fixture.nativeElement.querySelector('.then');
        expect(thenEl).not.toBeNull();
        const elseEl = fixture.nativeElement.querySelector('.else');
        expect(elseEl).toBeNull();
    });

    it('has permission (array not all match)', () => {
        fixture.componentInstance.permissionToTest = ['ValidPermission', 'InvalidPermission'];
        fixture.detectChanges();

        const thenEl = fixture.nativeElement.querySelector('.then');
        expect(thenEl).not.toBeNull();
        const elseEl = fixture.nativeElement.querySelector('.else');
        expect(elseEl).toBeNull();
    });

    it('does not have permission', () => {
        fixture.componentInstance.permissionToTest = 'InvalidPermission';
        fixture.detectChanges();

        const thenEl = fixture.nativeElement.querySelector('.then');
        expect(thenEl).toBeNull();
        const elseEl = fixture.nativeElement.querySelector('.else');
        expect(elseEl).not.toBeNull();
    });

    it('pass null', () => {
        fixture.componentInstance.permissionToTest = null;
        fixture.detectChanges();

        const thenEl = fixture.nativeElement.querySelector('.then');
        expect(thenEl).not.toBeNull();
        const elseEl = fixture.nativeElement.querySelector('.else');
        expect(elseEl).toBeNull();
    });
});

@Component({
    template: `
        <div *vdrIfPermissions="permissionToTest; else noPerms">
            <span class="then"></span>
        </div>
        <ng-template #noPerms><span class="else"></span></ng-template>
    `,
    standalone: false,
})
export class TestComponent {
    @Input() permissionToTest: string | string[] | null = '';
}
