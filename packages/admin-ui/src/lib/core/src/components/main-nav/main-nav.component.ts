import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { NavMenuItem, NavMenuSection } from '../../providers/nav-builder/nav-builder-types';
import { BaseNavComponent } from '../base-nav/base-nav.component';

@Component({
    selector: 'vdr-main-nav',
    templateUrl: './main-nav.component.html',
    styleUrls: ['./main-nav.component.scss'],
    standalone: false,
})
export class MainNavComponent extends BaseNavComponent implements OnInit {
    @Input() displayMode: string | undefined;
    @Output() itemClick = new EventEmitter<NavMenuItem>();
    mainMenuConfig$: Observable<NavMenuSection[]>;
    expandedSections: string[] = [];

    override ngOnInit(): void {
        super.ngOnInit();

        this.mainMenuConfig$ = this.navBuilderService.menuConfig$.pipe(
            map(sections =>
                sections.filter(s =>
                    this.displayMode ? s.displayMode === this.displayMode : !s.displayMode,
                ),
            ),
        );
    }

    toggleExpand(section: NavMenuSection) {
        if (this.expandedSections.includes(section.id)) {
            this.expandedSections = this.expandedSections.filter(id => id !== section.id);
        } else {
            this.expandedSections.push(section.id);
        }
    }

    setExpanded(section: NavMenuSection, expanded: boolean) {
        if (expanded) {
            this.expandedSections.push(section.id);
        } else {
            this.expandedSections = this.expandedSections.filter(id => id !== section.id);
        }
    }

    getStyleForSection(section: NavMenuSection) {
        if (section.collapsible) {
            if (this.expandedSections.includes(section.id)) {
                return { maxHeight: `${section.items.length * 33}px`, opacity: 1, visibility: 'visible' };
            } else {
                return { maxHeight: '0px', opacity: 0, visibility: 'hidden' };
            }
        }
    }

    onItemClick(item: NavMenuItem, event: MouseEvent) {
        item.onClick?.(event);
        this.itemClick.emit(item);
    }
}
