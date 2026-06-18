import {
    ChangeDetectionStrategy,
    Component,
    EventEmitter,
    forwardRef,
    Input,
    OnChanges,
    OnDestroy,
    OnInit,
    Output,
    SimpleChanges,
} from '@angular/core';
import {
    AbstractControl,
    ControlValueAccessor,
    NG_VALIDATORS,
    NG_VALUE_ACCESSOR,
    UntypedFormControl,
    UntypedFormGroup,
    ValidationErrors,
    Validator,
    Validators,
} from '@angular/forms';
import { BehaviorSubject, Observable, Subscription } from 'rxjs';
import {
    ConfigArg,
    ConfigArgDefinition,
    ConfigurableOperation,
    ConfigurableOperationDefinition,
} from '../../../common/generated-types';
import { getDefaultConfigArgValue } from '../../../common/utilities/configurable-operation-utils';
import { interpolateDescription } from '../../../common/utilities/interpolate-description';
import { CurrencyService } from '../../../providers/currency/currency.service';

/**
 * A form input which renders a card with the internal form fields of the given ConfigurableOperation.
 */
@Component({
    selector: 'vdr-configurable-input',
    templateUrl: './configurable-input.component.html',
    styleUrls: ['./configurable-input.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    providers: [
        {
            provide: NG_VALUE_ACCESSOR,
            useExisting: ConfigurableInputComponent,
            multi: true,
        },
        {
            provide: NG_VALIDATORS,
            useExisting: forwardRef(() => ConfigurableInputComponent),
            multi: true,
        },
    ],
    standalone: false,
})
export class ConfigurableInputComponent
    implements OnInit, OnChanges, OnDestroy, ControlValueAccessor, Validator
{
    @Input() operation?: ConfigurableOperation;
    @Input() operationDefinition?: ConfigurableOperationDefinition;
    @Input() readonly = false;
    @Input() removable = true;
    @Input() position = 0;
    @Input() hideDescription = false;
    @Output() remove = new EventEmitter<ConfigurableOperation>();
    argValues: { [name: string]: any } = {};
    onChange: (val: any) => void;
    onTouch: () => void;
    form = new UntypedFormGroup({});
    positionChange$: Observable<number>;
    private positionChangeSubject = new BehaviorSubject<number>(0);
    private subscription: Subscription;

    constructor(private currencyService: CurrencyService) {}

    interpolateDescription(): string {
        if (this.operationDefinition) {
            return interpolateDescription(
                this.operationDefinition,
                this.form.value,
                this.currencyService.precisionFactor,
            );
        } else {
            return '';
        }
    }

    ngOnInit() {
        this.positionChange$ = this.positionChangeSubject.asObservable();
    }

    ngOnChanges(changes: SimpleChanges) {
        if ('operation' in changes || 'operationDefinition' in changes) {
            this.createForm();
        }
        if ('position' in changes) {
            this.positionChangeSubject.next(this.position);
        }
    }

    ngOnDestroy() {
        if (this.subscription) {
            this.subscription.unsubscribe();
        }
    }

    registerOnChange(fn: any) {
        this.onChange = fn;
    }

    registerOnTouched(fn: any) {
        this.onTouch = fn;
    }

    setDisabledState(isDisabled: boolean) {
        if (isDisabled) {
            this.form.disable();
        } else {
            this.form.enable();
        }
    }

    writeValue(value: any): void {
        if (value) {
            this.form.patchValue(value);
        }
    }

    trackByName(index: number, arg: ConfigArg): string {
        return arg.name;
    }

    getArgDef(arg: ConfigArg): ConfigArgDefinition | undefined {
        return this.operationDefinition?.args.find(a => a.name === arg.name);
    }

    private createForm() {
        if (!this.operation) {
            return;
        }
        if (this.subscription) {
            this.subscription.unsubscribe();
        }
        this.form = new UntypedFormGroup({});
        (this.form as any).__id = Math.random().toString(36).substr(10);

        if (this.operation.args) {
            for (const arg of this.operationDefinition?.args || []) {
                let value: any = this.operation.args.find(a => a.name === arg.name)?.value;
                if (value === undefined) {
                    value = getDefaultConfigArgValue(arg);
                }
                const validators = arg.list ? undefined : arg.required ? Validators.required : undefined;
                this.form.addControl(arg.name, new UntypedFormControl(value, validators));
            }
        }

        this.subscription = this.form.valueChanges.subscribe(value => {
            if (this.onChange) {
                this.onChange({
                    code: this.operation && this.operation.code,
                    args: value,
                });
            }
            if (this.onTouch) {
                this.onTouch();
            }
        });
    }

    validate(c: AbstractControl): ValidationErrors | null {
        if (this.form.invalid) {
            return {
                required: true,
            };
        }
        return null;
    }
}
