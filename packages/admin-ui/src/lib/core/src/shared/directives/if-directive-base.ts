import { Directive, EmbeddedViewRef, OnDestroy, OnInit, TemplateRef, ViewContainerRef } from '@angular/core';
import { BehaviorSubject, Observable, Subscription } from 'rxjs';
import { switchMap } from 'rxjs/operators';

/**
 * A base class for implementing custom *ngIf-style structural directives based on custom conditions.
 *
 * @dynamic
 */
@Directive()
export class IfDirectiveBase<Args extends any[]> implements OnInit, OnDestroy {
    protected updateArgs$ = new BehaviorSubject<Args>([] as any);
    private readonly _thenTemplateRef: TemplateRef<any> | null = null;
    private _elseTemplateRef: TemplateRef<any> | null = null;
    private _thenViewRef: EmbeddedViewRef<any> | null = null;
    private _elseViewRef: EmbeddedViewRef<any> | null = null;
    private subscription: Subscription;

    constructor(
        private _viewContainer: ViewContainerRef,
        templateRef: TemplateRef<any>,
        private updateViewFn: (...args: Args) => Observable<boolean>,
    ) {
        this._thenTemplateRef = templateRef;
    }

    ngOnInit(): void {
        this.subscription = this.updateArgs$
            .pipe(switchMap(args => this.updateViewFn(...args)))
            .subscribe(result => {
                if (result) {
                    this.showThen();
                } else {
                    this.showElse();
                }
            });
    }

    ngOnDestroy(): void {
        if (this.subscription) {
            this.subscription.unsubscribe();
        }
    }

    protected setElseTemplate(templateRef: TemplateRef<any> | null) {
        this.assertTemplate('vdrIfPermissionsElse', templateRef);
        this._elseTemplateRef = templateRef;
        this._elseViewRef = null; // clear previous view if any.
    }

    private showThen() {
        if (!this._thenViewRef) {
            this._viewContainer.clear();
            this._elseViewRef = null;
            if (this._thenTemplateRef) {
                this._thenViewRef = this._viewContainer.createEmbeddedView(this._thenTemplateRef);
            }
        }
    }

    private showElse() {
        if (!this._elseViewRef) {
            this._viewContainer.clear();
            this._thenViewRef = null;
            if (this._elseTemplateRef) {
                this._elseViewRef = this._viewContainer.createEmbeddedView(this._elseTemplateRef);
            }
        }
    }

    private assertTemplate(property: string, templateRef: TemplateRef<any> | null): void {
        const isTemplateRefOrNull = !!(!templateRef || templateRef.createEmbeddedView);
        if (!isTemplateRefOrNull) {
            throw new Error(`${property} must be a TemplateRef, but received '${templateRef}'.`);
        }
    }
}
