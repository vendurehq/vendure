/* eslint-disable @typescript-eslint/no-non-null-assertion, no-console */
import { TestBed } from '@angular/core/testing';
import { take } from 'rxjs/operators';

import { NavMenuSection } from './nav-builder-types';
import { NavBuilderService } from './nav-builder.service';

describe('NavBuilderService', () => {
    let service: NavBuilderService;

    beforeEach(() => {
        TestBed.configureTestingModule({});
        service = TestBed.inject(NavBuilderService);
    });

    it('defineNavMenuSections', done => {
        service.defineNavMenuSections(getBaseNav());

        service.menuConfig$.pipe(take(1)).subscribe(result => {
            expect(result).toEqual(getBaseNav());
            done();
        });
    });

    describe('addNavMenuSection', () => {
        it('adding new section to end', done => {
            service.defineNavMenuSections(getBaseNav());
            service.addNavMenuSection({
                id: 'reports',
                label: 'Reports',
                items: [],
            });

            service.menuConfig$.pipe(take(1)).subscribe(result => {
                expect(result.map(section => section.id)).toEqual(['catalog', 'sales', 'reports']);
                done();
            });
        });

        it('adding new section before', done => {
            service.defineNavMenuSections(getBaseNav());
            service.addNavMenuSection(
                {
                    id: 'reports',
                    label: 'Reports',
                    items: [],
                },
                'sales',
            );

            service.menuConfig$.pipe(take(1)).subscribe(result => {
                expect(result.map(section => section.id)).toEqual(['catalog', 'reports', 'sales']);
                done();
            });
        });

        it('replacing an existing section', done => {
            service.defineNavMenuSections(getBaseNav());
            service.addNavMenuSection({
                id: 'sales',
                label: 'Custom Sales',
                items: [],
            });

            service.menuConfig$.pipe(take(1)).subscribe(result => {
                expect(result.map(section => section.id)).toEqual(['catalog', 'sales']);
                expect(result[1].label).toBe('Custom Sales');
                done();
            });
        });

        it('replacing and moving', done => {
            service.defineNavMenuSections(getBaseNav());
            service.addNavMenuSection(
                {
                    id: 'sales',
                    label: 'Custom Sales',
                    items: [],
                },
                'catalog',
            );

            service.menuConfig$.pipe(take(1)).subscribe(result => {
                expect(result.map(section => section.id)).toEqual(['sales', 'catalog']);
                expect(result[0].label).toBe('Custom Sales');
                done();
            });
        });
    });

    describe('addNavMenuItem()', () => {
        it('adding to non-existent section', done => {
            spyOn(console, 'error');
            service.defineNavMenuSections(getBaseNav());
            service.addNavMenuItem(
                {
                    id: 'fulfillments',
                    label: 'Fulfillments',
                    routerLink: ['/extensions', 'fulfillments'],
                },
                'farm-tools',
            );

            service.menuConfig$.pipe(take(1)).subscribe(result => {
                expect(console.error).toHaveBeenCalledWith(
                    'Could not add menu item "fulfillments", section "farm-tools" does not exist',
                );
                done();
            });
        });

        it('adding to end of section', done => {
            service.defineNavMenuSections(getBaseNav());
            service.addNavMenuItem(
                {
                    id: 'fulfillments',
                    label: 'Fulfillments',
                    routerLink: ['/extensions', 'fulfillments'],
                },
                'sales',
            );

            service.menuConfig$.pipe(take(1)).subscribe(result => {
                const salesSection = result.find(r => r.id === 'sales')!;

                expect(salesSection.items.map(item => item.id)).toEqual(['orders', 'fulfillments']);
                done();
            });
        });

        it('adding before existing item', done => {
            service.defineNavMenuSections(getBaseNav());
            service.addNavMenuItem(
                {
                    id: 'fulfillments',
                    label: 'Fulfillments',
                    routerLink: ['/extensions', 'fulfillments'],
                },
                'sales',
                'orders',
            );

            service.menuConfig$.pipe(take(1)).subscribe(result => {
                const salesSection = result.find(r => r.id === 'sales')!;

                expect(salesSection.items.map(item => item.id)).toEqual(['fulfillments', 'orders']);
                done();
            });
        });

        it('replacing existing item', done => {
            service.defineNavMenuSections(getBaseNav());
            service.addNavMenuItem(
                {
                    id: 'facets',
                    label: 'Custom Facets',
                    routerLink: ['/custom-facets'],
                },
                'catalog',
            );

            service.menuConfig$.pipe(take(1)).subscribe(result => {
                const catalogSection = result.find(r => r.id === 'catalog')!;

                expect(catalogSection.items.map(item => item.id)).toEqual(['products', 'facets']);
                expect(catalogSection.items[1].label).toBe('Custom Facets');
                done();
            });
        });

        it('replacing existing item and moving', done => {
            service.defineNavMenuSections(getBaseNav());
            service.addNavMenuItem(
                {
                    id: 'facets',
                    label: 'Custom Facets',
                    routerLink: ['/custom-facets'],
                },
                'catalog',
                'products',
            );

            service.menuConfig$.pipe(take(1)).subscribe(result => {
                const catalogSection = result.find(r => r.id === 'catalog')!;

                expect(catalogSection.items.map(item => item.id)).toEqual(['facets', 'products']);
                expect(catalogSection.items[0].label).toBe('Custom Facets');
                done();
            });
        });
    });

    function getBaseNav(): NavMenuSection[] {
        return [
            {
                id: 'catalog',
                label: 'Catalog',
                items: [
                    {
                        id: 'products',
                        label: 'Products',
                        icon: 'library',
                        routerLink: ['/catalog', 'products'],
                    },
                    {
                        id: 'facets',
                        label: 'Facets',
                        icon: 'tag',
                        routerLink: ['/catalog', 'facets'],
                    },
                ],
            },
            {
                id: 'sales',
                label: 'Sales',
                requiresPermission: 'ReadOrder',
                items: [
                    {
                        id: 'orders',
                        label: 'Orders',
                        routerLink: ['/orders'],
                        icon: 'shopping-cart',
                    },
                ],
            },
        ];
    }
});
