import { NgModule, Component } from '@angular/core';
import { FormControl } from '@angular/forms';
import {
    SharedModule,
    FormInputComponent,
    registerFormInputComponent,
    StringCustomFieldConfig,
    DataService,
} from '@vendure/admin-ui/core';
import gql from 'graphql-tag';

@Component({
    template: `
        <div class="login-option-container">
            <div *ngFor="let option of defaultLoginOptions" class="login-option">
                <input
                    type="checkbox"
                    [id]="option"
                    [name]="option"
                    [value]="option"
                    [checked]="checkedOptions.includes(option)"
                    (change)="onCheckboxChange($event, option)"
                />
                <label>{{ option }}</label>
            </div>
        </div>
    `,
    // styleUrls: ['./module-styles/checkboxes-form-inputs.component.scss'],
})
export class LoginOptionCheckboxes implements FormInputComponent<StringCustomFieldConfig> {
    isListInput = true;
    readonly = false;
    config: StringCustomFieldConfig;
    formControl: FormControl;
    data: string[] = [];
    defaultLoginOptions: string[] = ['sso', 'password', 'magicLink'];
    checkedOptions: string[] = [];

    constructor(private dataService: DataService) {}

    ngOnInit() {
        // this.data = JSON.parse(this.formControl.value);
        console.log('formControl', this.formControl);
        console.log('this.defaultLoginOptions', this.defaultLoginOptions);
        this.checkedOptions = [...(this.formControl.value ?? [])];
    }

    onCheckboxChange(event: any, option: string) {
        this.dataService
            .query(gql`
                query GetCustomerAuthOptions {
                    customer {
                        id
                        customFields {
                            org {
                                authOptions
                            }
                        }
                    }
                }
            `)
            .single$.subscribe(data => {
                console.log('data', data);
            });

        if (this.checkedOptions.includes(option)) {
            this.checkedOptions = this.checkedOptions.filter(item => item !== option);
        } else {
            this.checkedOptions.push(option);
        }
        console.log('this.checkedOptions', this.checkedOptions);
        this.formControl.setValue(this.checkedOptions);
        this.formControl.markAsDirty();
    }
}
