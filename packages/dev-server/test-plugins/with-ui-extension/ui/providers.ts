import { Injectable } from '@angular/core';
import { addActionBarItem, addNavMenuSection } from '@vendure/admin-ui/core';
import { interval } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';

@Injectable()
class MyService {
    greet() {
        console.log('Hello!');
    }
}

export default [
    MyService,
    addNavMenuSection(
        {
            id: 'greeter',
            label: 'My Extensions',
            items: [
                {
                    id: 'greeter',
                    label: 'Greeter',
                    routerLink: ['/extensions/example/greet'],
                    // Icon can be any of https://clarity.design/icons
                    icon: 'cursor-hand-open',
                },
            ],
        },
        // Add this section before the "settings" section
        'settings',
    ),
    addActionBarItem({
        id: 'test',
        icon: 'cursor-hand-open',
        label: 'Test',
        locationId: 'order-detail',
        buttonState: context => {
            return context.route.data.pipe(
                switchMap(data => data.detail.entity),
                map((order: any) => {
                    context.injector.get(MyService).greet();
                    console.log(order);
                    return {
                        disabled: order.state === 'AddingItems',
                        visible: true,
                    };
                }),
            );
            // return interval(1000).pipe(
            //     map(t => {
            //         console.log(t);
            //         return {
            //             disabled: t % 2 === 0,
            //             visible: t % 5 !== 0,
            //         };
            //     }),
            // );
        },
    }),
];
