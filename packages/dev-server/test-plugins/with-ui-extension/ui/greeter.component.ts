// project/ui-extensions/greeter.component.ts
import { Component } from '@angular/core';

@Component({
    selector: 'greeter',
    template: '<h1>{{ greeting }}</h1>',
})
export class GreeterComponent {
    greeting = 'Hello!';
}
