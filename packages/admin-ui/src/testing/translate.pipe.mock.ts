import { NgModule, Pipe, PipeTransform } from '@angular/core';

@Pipe({
    name: 'translate',
    standalone: false
})
export class MockTranslatePipe implements PipeTransform {
    transform(value: any, ...args: any[]): any {
        return value;
    }
}

// Work around for https://github.com/angular/angular/issues/13590
@NgModule({
    declarations: [MockTranslatePipe],
})
export class MockTranslatePipeModule {}
