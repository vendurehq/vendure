import { Component, DebugElement } from '@angular/core';
import { ComponentFixture, fakeAsync, TestBed, tick } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router, Routes } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { notNullOrUndefined } from '@vendure/common/lib/shared-utils';
import { BehaviorSubject, Observable, of as observableOf } from 'rxjs';

import { MockTranslatePipe } from '../../../../../testing/translate.pipe.mock';
import { DataService } from '../../data/providers/data.service';
import { BreadcrumbLabelLinkPair } from '../../providers/breadcrumb/breadcrumb.service';

import { BreadcrumbComponent } from './breadcrumb.component';

describe('BeadcrumbsComponent', () => {
    let baseRouteConfig: Routes;
    let router: Router;
    let breadcrumbSubject: BehaviorSubject<string>;

    beforeEach(() => {
        breadcrumbSubject = new BehaviorSubject<string>('Initial Value');

        const leafRoute = {
            path: 'string-grandchild',
            data: { breadcrumb: 'Grandchild' },
            component: TestChildComponent,
        };

        baseRouteConfig = [
            {
                path: '',
                component: TestParentComponent,
                data: { breadcrumb: 'Root' },
                children: [
                    {
                        path: 'string-child',
                        component: TestParentComponent,
                        data: { breadcrumb: 'Child' },
                        children: [leafRoute],
                    },
                    {
                        path: 'no-breadcrumb-child',
                        component: TestParentComponent,
                        children: [leafRoute],
                    },
                    {
                        path: 'simple-function-child',
                        component: TestParentComponent,
                        data: {
                            breadcrumb: () => 'String From Function',
                        },
                        children: [leafRoute],
                    },
                    {
                        path: 'resolved-function-child',
                        component: TestParentComponent,
                        data: {
                            breadcrumb: (data: any) => data.foo,
                        },
                        resolve: { foo: FooResolver },
                        children: [leafRoute],
                    },
                    {
                        path: 'params-child/:name',
                        component: TestParentComponent,
                        data: {
                            breadcrumb: (data: any, params: any) => params['name'],
                        },
                        children: [leafRoute],
                    },
                    {
                        path: 'single-pair-child',
                        component: TestParentComponent,
                        data: {
                            breadcrumb: {
                                label: 'Pair',
                                link: ['foo', 'bar', { p: 1 }],
                            } as BreadcrumbLabelLinkPair,
                        },
                        children: [leafRoute],
                    },
                    {
                        path: 'array-pair-child',
                        component: TestParentComponent,
                        data: {
                            breadcrumb: [
                                {
                                    label: 'PairA',
                                    link: ['foo', 'bar'],
                                },
                                {
                                    label: 'PairB',
                                    link: ['baz', 'quux'],
                                },
                            ] as BreadcrumbLabelLinkPair[],
                        },
                        children: [leafRoute],
                    },
                    {
                        path: 'pair-function-child',
                        component: TestParentComponent,
                        data: {
                            breadcrumb: () =>
                                [
                                    {
                                        label: 'PairA',
                                        link: ['foo', 'bar'],
                                    },
                                    {
                                        label: 'PairB',
                                        link: ['baz', 'quux'],
                                    },
                                ] as BreadcrumbLabelLinkPair[],
                        },
                        children: [leafRoute],
                    },
                    {
                        path: 'relative-parent',
                        component: TestParentComponent,
                        data: { breadcrumb: 'Parent' },
                        children: [
                            {
                                path: 'relative-child',
                                component: TestParentComponent,
                                data: {
                                    breadcrumb: {
                                        label: 'Child',
                                        link: ['./', 'foo', { p: 1 }],
                                    } as BreadcrumbLabelLinkPair,
                                },
                                children: [leafRoute],
                            },
                            {
                                path: 'relative-sibling',
                                component: TestParentComponent,
                                data: {
                                    breadcrumb: {
                                        label: 'Sibling',
                                        link: ['../', 'foo', { p: 1 }],
                                    } as BreadcrumbLabelLinkPair,
                                },
                                children: [leafRoute],
                            },
                        ],
                    },
                    {
                        path: 'deep-pair-child-1',
                        component: TestParentComponent,
                        data: {
                            breadcrumb: 'Child 1',
                        },
                        children: [
                            {
                                path: 'deep-pair-child-2',
                                component: TestParentComponent,
                                data: {
                                    breadcrumb: () =>
                                        [
                                            {
                                                label: 'PairA',
                                                link: ['./', 'child', 'path'],
                                            },
                                            {
                                                label: 'PairB',
                                                link: ['../', 'sibling', 'path'],
                                            },
                                            {
                                                label: 'PairC',
                                                link: ['absolute', 'path'],
                                            },
                                        ] as BreadcrumbLabelLinkPair[],
                                },
                                children: [leafRoute],
                            },
                        ],
                    },
                    {
                        path: 'observable-string',
                        component: TestParentComponent,
                        data: {
                            breadcrumb: observableOf('Observable String'),
                        },
                    },
                    {
                        path: 'observable-pair',
                        component: TestParentComponent,
                        data: {
                            breadcrumb: observableOf({
                                label: 'Observable Pair',
                                link: ['foo', 'bar', { p: 1 }],
                            } as BreadcrumbLabelLinkPair),
                        },
                    },
                    {
                        path: 'observable-array-pair',
                        component: TestParentComponent,
                        data: {
                            breadcrumb: [
                                {
                                    label: 'Observable PairA',
                                    link: ['foo', 'bar'],
                                },
                                {
                                    label: 'Observable PairB',
                                    link: ['baz', 'quux'],
                                },
                            ] as BreadcrumbLabelLinkPair[],
                        },
                    },
                    {
                        path: 'function-observable',
                        component: TestParentComponent,
                        data: {
                            breadcrumb: () => observableOf('Observable String From Function'),
                        },
                    },
                    {
                        path: 'observable-string-subject',
                        component: TestParentComponent,
                        data: {
                            breadcrumb: breadcrumbSubject.asObservable(),
                        },
                        children: [leafRoute],
                    },
                ],
            },
        ];

        TestBed.configureTestingModule({
            imports: [RouterTestingModule.withRoutes(baseRouteConfig)],
            declarations: [BreadcrumbComponent, TestParentComponent, TestChildComponent, MockTranslatePipe],
            providers: [FooResolver, { provide: DataService, useClass: class {} }],
        }).compileComponents();

        router = TestBed.get(Router);
    });

    /**
     * Navigates to the provided route and returns the fixture for the TestChildComponent at that route.
     */
    function getFixtureForRoute(
        route: string[],
        testFn: (fixture: ComponentFixture<TestComponent>) => void,
    ): () => void {
        return fakeAsync(() => {
            const fixture = TestBed.createComponent(TestChildComponent);
            // Run in ngZone to prevent warning: https://github.com/angular/angular/issues/25837#issuecomment-445796236
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            fixture.ngZone!.run(() => {
                router.navigate(route);
            });
            fixture.detectChanges();
            tick();
            fixture.detectChanges();
            testFn(fixture);
        });
    }

    it(
        'shows correct labels for string breadcrumbs',
        getFixtureForRoute(['', 'string-child', 'string-grandchild'], fixture => {
            const labels = getBreadcrumbLabels(fixture);
            expect(labels).toEqual(['Root', 'Child', 'Grandchild']);
        }),
    );

    it(
        'links have correct href',
        getFixtureForRoute(['', 'string-child', 'string-grandchild'], fixture => {
            const links = getBreadcrumbLinks(fixture);
            expect(links).toEqual(['/', '/string-child']);
        }),
    );

    it(
        'skips a route with no breadcrumbs configured',
        getFixtureForRoute(['', 'no-breadcrumb-child', 'string-grandchild'], fixture => {
            const labels = getBreadcrumbLabels(fixture);
            expect(labels).toEqual(['Root', 'Grandchild']);
        }),
    );

    it(
        'shows correct label for function breadcrumb',
        getFixtureForRoute(['', 'simple-function-child', 'string-grandchild'], fixture => {
            const labels = getBreadcrumbLabels(fixture);
            expect(labels).toEqual(['Root', 'String From Function', 'Grandchild']);
        }),
    );

    it(
        'works with resolved data',
        getFixtureForRoute(['', 'resolved-function-child', 'string-grandchild'], fixture => {
            const labels = getBreadcrumbLabels(fixture);
            expect(labels).toEqual(['Root', 'Foo', 'Grandchild']);
        }),
    );

    it(
        'works with data from parameters',
        getFixtureForRoute(['', 'params-child', 'Bar', 'string-grandchild'], fixture => {
            const labels = getBreadcrumbLabels(fixture);
            expect(labels).toEqual(['Root', 'Bar', 'Grandchild']);
        }),
    );

    it(
        'works with a BreadcrumbLabelLinkPair',
        getFixtureForRoute(['', 'single-pair-child', 'string-grandchild'], fixture => {
            const labels = getBreadcrumbLabels(fixture);
            const links = getBreadcrumbLinks(fixture);
            expect(labels).toEqual(['Root', 'Pair', 'Grandchild']);
            expect(links).toEqual(['/', '/foo/bar;p=1']);
        }),
    );

    it(
        'works with array of BreadcrumbLabelLinkPairs',
        getFixtureForRoute(['', 'array-pair-child', 'string-grandchild'], fixture => {
            const labels = getBreadcrumbLabels(fixture);
            const links = getBreadcrumbLinks(fixture);
            expect(labels).toEqual(['Root', 'PairA', 'PairB', 'Grandchild']);
            expect(links).toEqual(['/', '/foo/bar', '/baz/quux']);
        }),
    );

    it(
        'works with function returning BreadcrumbLabelLinkPairs',
        getFixtureForRoute(['', 'pair-function-child', 'string-grandchild'], fixture => {
            const labels = getBreadcrumbLabels(fixture);
            const links = getBreadcrumbLinks(fixture);
            console.log(`labels: ${labels}`);
            expect(labels).toEqual(['Root', 'PairA', 'PairB', 'Grandchild']);
            expect(links).toEqual(['/', '/foo/bar', '/baz/quux']);
        }),
    );

    it(
        'works with relative child paths in a BreadcrumbLabelLinkPair',
        getFixtureForRoute(['', 'relative-parent', 'relative-child', 'string-grandchild'], fixture => {
            const labels = getBreadcrumbLabels(fixture);
            const links = getBreadcrumbLinks(fixture);
            expect(labels).toEqual(['Root', 'Parent', 'Child', 'Grandchild']);
            expect(links).toEqual(['/', '/relative-parent', '/relative-parent/relative-child/foo;p=1']);
        }),
    );

    it(
        'works with relative sibling paths in a BreadcrumbLabelLinkPair',
        getFixtureForRoute(['', 'relative-parent', 'relative-sibling', 'string-grandchild'], fixture => {
            const labels = getBreadcrumbLabels(fixture);
            const links = getBreadcrumbLinks(fixture);
            expect(labels).toEqual(['Root', 'Parent', 'Sibling', 'Grandchild']);
            expect(links).toEqual(['/', '/relative-parent', '/relative-parent/foo;p=1']);
        }),
    );

    it(
        'array of BreadcrumbLabelLinkPairs paths compose correctly',
        getFixtureForRoute(['', 'deep-pair-child-1', 'deep-pair-child-2', 'string-grandchild'], fixture => {
            const labels = getBreadcrumbLabels(fixture);
            const links = getBreadcrumbLinks(fixture);
            expect(labels).toEqual(['Root', 'Child 1', 'PairA', 'PairB', 'PairC', 'Grandchild']);
            expect(links).toEqual([
                '/',
                '/deep-pair-child-1',
                '/deep-pair-child-1/deep-pair-child-2/child/path',
                '/deep-pair-child-1/sibling/path',
                '/absolute/path',
            ]);
        }),
    );

    it(
        'shows correct labels for observable of string',
        getFixtureForRoute(['', 'observable-string'], fixture => {
            const labels = getBreadcrumbLabels(fixture);
            const links = getBreadcrumbLinks(fixture);
            expect(labels).toEqual(['Root', 'Observable String']);
        }),
    );

    it(
        'shows correct labels for observable of BreadcrumbLabelLinkPair',
        getFixtureForRoute(['', 'observable-pair'], fixture => {
            const labels = getBreadcrumbLabels(fixture);
            const links = getBreadcrumbLinks(fixture);
            expect(labels).toEqual(['Root', 'Observable Pair']);
        }),
    );

    it(
        'shows correct labels for observable of BreadcrumbLabelLinkPair array',
        getFixtureForRoute(['', 'observable-array-pair'], fixture => {
            const labels = getBreadcrumbLabels(fixture);
            const links = getBreadcrumbLinks(fixture);
            expect(labels).toEqual(['Root', 'Observable PairA', 'Observable PairB']);
            expect(links).toEqual(['/', '/foo/bar']);
        }),
    );

    it(
        'shows correct labels for function returning observable string',
        getFixtureForRoute(['', 'function-observable'], fixture => {
            const labels = getBreadcrumbLabels(fixture);
            const links = getBreadcrumbLinks(fixture);
            expect(labels).toEqual(['Root', 'Observable String From Function']);
        }),
    );

    it(
        'labels update when observables emit new values',
        getFixtureForRoute(['', 'observable-string-subject', 'string-grandchild'], fixture => {
            expect(getBreadcrumbLabels(fixture)).toEqual(['Root', 'Initial Value', 'Grandchild']);
            breadcrumbSubject.next('New Value');
            fixture.detectChanges();
            expect(getBreadcrumbLabels(fixture)).toEqual(['Root', 'New Value', 'Grandchild']);
        }),
    );
});

function getBreadcrumbsElement(fixture: ComponentFixture<TestComponent>): DebugElement {
    return fixture.debugElement.query(By.directive(BreadcrumbComponent));
}

function getBreadcrumbListItems(fixture: ComponentFixture<TestComponent>): HTMLLIElement[] {
    return fixture.debugElement.queryAll(By.css('.breadcrumbs:not(.mobile) li')).map(de => de.nativeElement);
}

function getBreadcrumbLabels(fixture: ComponentFixture<TestComponent>): string[] {
    const labels = getBreadcrumbListItems(fixture).map(item => item.innerText.trim());
    return labels;
}

function getBreadcrumbLinks(fixture: ComponentFixture<TestComponent>): string[] {
    return getBreadcrumbListItems(fixture)
        .map(el => el.querySelector('a'))
        .filter(notNullOrUndefined)
        .map(a => a.getAttribute('href'))
        .filter(notNullOrUndefined);
}

@Component({
    // eslint-disable-next-line @angular-eslint/component-selector
    selector: 'test-root-component',
    template: `
        <vdr-breadcrumb></vdr-breadcrumb>
        <router-outlet></router-outlet>
    `,
    standalone: false,
})
class TestParentComponent {}

@Component({
    // eslint-disable-next-line @angular-eslint/component-selector
    selector: 'test-child-component',
    template: `
        <vdr-breadcrumb></vdr-breadcrumb>
    `,
    standalone: false,
})
class TestChildComponent {}

type TestComponent = TestParentComponent | TestChildComponent;

class FooResolver {
    resolve(): Observable<string> {
        return observableOf('Foo');
    }
}
