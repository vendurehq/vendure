import { DragDropModule } from '@angular/cdk/drag-drop';
import { OverlayModule } from '@angular/cdk/overlay';
import { A11yModule } from '@angular/cdk/a11y';
import { CommonModule } from '@angular/common';
import { CUSTOM_ELEMENTS_SCHEMA, NgModule } from '@angular/core';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { ClarityModule } from '@clr/angular';
import '@clr/icons';
import '@clr/icons/shapes/all-shapes';
import { NgSelectModule } from '@ng-select/ng-select';
import { TranslateModule } from '@ngx-translate/core';
import '@webcomponents/custom-elements/custom-elements.min.js';
import { NgxPaginationModule } from 'ngx-pagination';

import { ModalService } from '../providers/modal/modal.service';

import { ActionBarItemsComponent } from './components/action-bar-items/action-bar-items.component';
import {
    ActionBarComponent,
    ActionBarLeftComponent,
    ActionBarRightComponent,
} from './components/action-bar/action-bar.component';
import { AddressFormComponent } from './components/address-form/address-form.component';
import { AffixedInputComponent } from './components/affixed-input/affixed-input.component';
import { PercentageSuffixInputComponent } from './components/affixed-input/percentage-suffix-input.component';
import { AssetFileInputComponent } from './components/asset-file-input/asset-file-input.component';
import { AssetGalleryComponent } from './components/asset-gallery/asset-gallery.component';
import { AssetPickerDialogComponent } from './components/asset-picker-dialog/asset-picker-dialog.component';
import { AssetPreviewDialogComponent } from './components/asset-preview-dialog/asset-preview-dialog.component';
import { AssetPreviewLinksComponent } from './components/asset-preview-links/asset-preview-links.component';
import { AssetPreviewComponent } from './components/asset-preview/asset-preview.component';
import { AssetsComponent } from './components/assets/assets.component';
import { AssetSearchInputComponent } from './components/asset-search-input/asset-search-input.component';
import { AssignToChannelDialogComponent } from './components/assign-to-channel-dialog/assign-to-channel-dialog.component';
import { BulkActionMenuComponent } from './components/bulk-action-menu/bulk-action-menu.component';
import { ChannelAssignmentControlComponent } from './components/channel-assignment-control/channel-assignment-control.component';
import { ChannelBadgeComponent } from './components/channel-badge/channel-badge.component';
import { ChipComponent } from './components/chip/chip.component';
import { ConfigurableInputComponent } from './components/configurable-input/configurable-input.component';
import { CurrencyInputComponent } from './components/currency-input/currency-input.component';
import { CustomDetailComponentHostComponent } from './components/custom-detail-component-host/custom-detail-component-host.component';
import { CustomFieldControlComponent } from './components/custom-field-control/custom-field-control.component';
import { CustomerLabelComponent } from './components/customer-label/customer-label.component';
import { DataTable2ColumnComponent } from './components/data-table-2/data-table-column.component';
import { DataTableCustomFieldColumnComponent } from './components/data-table-2/data-table-custom-field-column.component';
import { DataTable2SearchComponent } from './components/data-table-2/data-table-search.component';
import { DataTable2Component } from './components/data-table-2/data-table2.component';
import { DataTableColumnPickerComponent } from './components/data-table-column-picker/data-table-column-picker.component';
import { DataTableFilterLabelComponent } from './components/data-table-filter-label/data-table-filter-label.component';
import { CustomFilterComponentDirective } from './components/data-table-filters/custom-filter-component.directive';
import { DataTableFiltersComponent } from './components/data-table-filters/data-table-filters.component';
import { DataTableColumnComponent } from './components/data-table/data-table-column.component';
import { DataTableComponent } from './components/data-table/data-table.component';
import { DatetimePickerComponent } from './components/datetime-picker/datetime-picker.component';
import { DropdownItemDirective } from './components/dropdown/dropdown-item.directive';
import { DropdownMenuComponent } from './components/dropdown/dropdown-menu.component';
import { DropdownTriggerDirective } from './components/dropdown/dropdown-trigger.directive';
import { DropdownComponent } from './components/dropdown/dropdown.component';
import { EditNoteDialogComponent } from './components/edit-note-dialog/edit-note-dialog.component';
import { EmptyPlaceholderComponent } from './components/empty-placeholder/empty-placeholder.component';
import { EntityInfoComponent } from './components/entity-info/entity-info.component';
import { FacetValueChipComponent } from './components/facet-value-chip/facet-value-chip.component';
import { FacetValueSelectorComponent } from './components/facet-value-selector/facet-value-selector.component';
import { FocalPointControlComponent } from './components/focal-point-control/focal-point-control.component';
import { FormFieldControlDirective } from './components/form-field/form-field-control.directive';
import { FormFieldComponent } from './components/form-field/form-field.component';
import { FormItemComponent } from './components/form-item/form-item.component';
import { FormattedAddressComponent } from './components/formatted-address/formatted-address.component';
import { HelpTooltipComponent } from './components/help-tooltip/help-tooltip.component';
import { HistoryEntryDetailComponent } from './components/history-entry-detail/history-entry-detail.component';
import { ItemsPerPageControlsComponent } from './components/items-per-page-controls/items-per-page-controls.component';
import { LabeledDataComponent } from './components/labeled-data/labeled-data.component';
import { LanguageSelectorComponent } from './components/language-selector/language-selector.component';
import { LocalizedTextComponent } from './components/localized-text/localized-text.component';
import { ManageTagsDialogComponent } from './components/manage-tags-dialog/manage-tags-dialog.component';
import { DialogButtonsDirective } from './components/modal-dialog/dialog-buttons.directive';
import { DialogComponentOutletComponent } from './components/modal-dialog/dialog-component-outlet.component';
import { DialogTitleDirective } from './components/modal-dialog/dialog-title.directive';
import { ModalDialogComponent } from './components/modal-dialog/modal-dialog.component';
import { ObjectTreeComponent } from './components/object-tree/object-tree.component';
import { OrderStateLabelComponent } from './components/order-state-label/order-state-label.component';
import { PageBlockComponent } from './components/page-block/page-block.component';
import { PageBodyComponent } from './components/page-body/page-body.component';
import { PageDetailLayoutComponent } from './components/page-detail-layout/page-detail-layout.component';
import { PageDetailSidebarComponent } from './components/page-detail-layout/page-detail-sidebar.component';
import { PageEntityInfoComponent } from './components/page-entity-info/page-entity-info.component';
import { PageHeaderDescriptionComponent } from './components/page-header-description/page-header-description.component';
import { PageHeaderTabsComponent } from './components/page-header-tabs/page-header-tabs.component';
import { PageHeaderComponent } from './components/page-header/page-header.component';
import { PageTitleComponent } from './components/page-title/page-title.component';
import { PageComponent } from './components/page/page.component';
import { PaginationControlsComponent } from './components/pagination-controls/pagination-controls.component';
import { ProductMultiSelectorDialogComponent } from './components/product-multi-selector-dialog/product-multi-selector-dialog.component';
import { ProductSearchInputComponent } from './components/product-search-input/product-search-input.component';
import { ProductVariantSelectorComponent } from './components/product-variant-selector/product-variant-selector.component';
import { RadioCardFieldsetComponent } from './components/radio-card/radio-card-fieldset.component';
import { RadioCardComponent } from './components/radio-card/radio-card.component';
import { ExternalImageDialogComponent } from './components/rich-text-editor/external-image-dialog/external-image-dialog.component';
import { LinkDialogComponent } from './components/rich-text-editor/link-dialog/link-dialog.component';
import { ContextMenuComponent } from './components/rich-text-editor/prosemirror/context-menu/context-menu.component';
import { RawHtmlDialogComponent } from './components/rich-text-editor/raw-html-dialog/raw-html-dialog.component';
import { RichTextEditorComponent } from './components/rich-text-editor/rich-text-editor.component';
import { SelectToggleComponent } from './components/select-toggle/select-toggle.component';
import { SimpleDialogComponent } from './components/simple-dialog/simple-dialog.component';
import { SplitViewComponent } from './components/split-view/split-view.component';
import {
    SplitViewLeftDirective,
    SplitViewRightDirective,
} from './components/split-view/split-view.directive';
import { StatusBadgeComponent } from './components/status-badge/status-badge.component';
import { TabbedCustomFieldsComponent } from './components/tabbed-custom-fields/tabbed-custom-fields.component';
import { TableRowActionComponent } from './components/table-row-action/table-row-action.component';
import { TagSelectorComponent } from './components/tag-selector/tag-selector.component';
import { TimelineEntryComponent } from './components/timeline-entry/timeline-entry.component';
import { TitleInputComponent } from './components/title-input/title-input.component';
import { UiExtensionPointComponent } from './components/ui-extension-point/ui-extension-point.component';
import { DisabledDirective } from './directives/disabled.directive';
import { IfDefaultChannelActiveDirective } from './directives/if-default-channel-active.directive';
import { IfMultichannelDirective } from './directives/if-multichannel.directive';
import { IfPermissionsDirective } from './directives/if-permissions.directive';
import { BooleanFormInputComponent } from './dynamic-form-inputs/boolean-form-input/boolean-form-input.component';
import { HtmlEditorFormInputComponent } from './dynamic-form-inputs/code-editor-form-input/html-editor-form-input.component';
import { JsonEditorFormInputComponent } from './dynamic-form-inputs/code-editor-form-input/json-editor-form-input.component';
import { CombinationModeFormInputComponent } from './dynamic-form-inputs/combination-mode-form-input/combination-mode-form-input.component';
import { CurrencyFormInputComponent } from './dynamic-form-inputs/currency-form-input/currency-form-input.component';
import { CustomerGroupFormInputComponent } from './dynamic-form-inputs/customer-group-form-input/customer-group-form-input.component';
import { DateFormInputComponent } from './dynamic-form-inputs/date-form-input/date-form-input.component';
import { DynamicFormInputComponent } from './dynamic-form-inputs/dynamic-form-input/dynamic-form-input.component';
import { FacetValueFormInputComponent } from './dynamic-form-inputs/facet-value-form-input/facet-value-form-input.component';
import { NumberFormInputComponent } from './dynamic-form-inputs/number-form-input/number-form-input.component';
import { PasswordFormInputComponent } from './dynamic-form-inputs/password-form-input/password-form-input.component';
import { ProductMultiSelectorFormInputComponent } from './dynamic-form-inputs/product-multi-selector-form-input/product-multi-selector-form-input.component';
import { ProductSelectorFormInputComponent } from './dynamic-form-inputs/product-selector-form-input/product-selector-form-input.component';
import { RelationAssetInputComponent } from './dynamic-form-inputs/relation-form-input/asset/relation-asset-input.component';
import { RelationCustomerInputComponent } from './dynamic-form-inputs/relation-form-input/customer/relation-customer-input.component';
import { RelationGenericInputComponent } from './dynamic-form-inputs/relation-form-input/generic/relation-generic-input.component';
import { RelationProductVariantInputComponent } from './dynamic-form-inputs/relation-form-input/product-variant/relation-product-variant-input.component';
import { RelationProductInputComponent } from './dynamic-form-inputs/relation-form-input/product/relation-product-input.component';
import {
    RelationCardComponent,
    RelationCardDetailDirective,
    RelationCardPreviewDirective,
} from './dynamic-form-inputs/relation-form-input/relation-card/relation-card.component';
import { RelationFormInputComponent } from './dynamic-form-inputs/relation-form-input/relation-form-input.component';
import { RelationSelectorDialogComponent } from './dynamic-form-inputs/relation-form-input/relation-selector-dialog/relation-selector-dialog.component';
import { RichTextFormInputComponent } from './dynamic-form-inputs/rich-text-form-input/rich-text-form-input.component';
import { SelectFormInputComponent } from './dynamic-form-inputs/select-form-input/select-form-input.component';
import { StructFormInputComponent } from './dynamic-form-inputs/struct-form-input/struct-form-input.component';
import { TextFormInputComponent } from './dynamic-form-inputs/text-form-input/text-form-input.component';
import { TextareaFormInputComponent } from './dynamic-form-inputs/textarea-form-input/textarea-form-input.component';
import { AssetPreviewPipe } from './pipes/asset-preview.pipe';
import { ChannelLabelPipe } from './pipes/channel-label.pipe';
import { CustomFieldDescriptionPipe } from './pipes/custom-field-description.pipe';
import { CustomFieldLabelPipe } from './pipes/custom-field-label.pipe';
import { DurationPipe } from './pipes/duration.pipe';
import { FileSizePipe } from './pipes/file-size.pipe';
import { HasPermissionPipe } from './pipes/has-permission.pipe';
import { LocaleCurrencyNamePipe } from './pipes/locale-currency-name.pipe';
import { LocaleCurrencyPipe } from './pipes/locale-currency.pipe';
import { LocaleDatePipe } from './pipes/locale-date.pipe';
import { LocaleLanguageNamePipe } from './pipes/locale-language-name.pipe';
import { LocaleRegionNamePipe } from './pipes/locale-region-name.pipe';
import { SentenceCasePipe } from './pipes/sentence-case.pipe';
import { SortPipe } from './pipes/sort.pipe';
import { StateI18nTokenPipe } from './pipes/state-i18n-token.pipe';
import { StringToColorPipe } from './pipes/string-to-color.pipe';
import { TimeAgoPipe } from './pipes/time-ago.pipe';
import { CanDeactivateDetailGuard } from './providers/routing/can-deactivate-detail-guard';
import { CardComponent, CardControlsDirective } from './components/card/card.component';
import { ZoneSelectorComponent } from './components/zone-selector/zone-selector.component';
import { ChartComponent } from './components/chart/chart.component';
import { CurrencyCodeSelectorComponent } from './components/currency-code-selector/currency-code-selector.component';
import { LanguageCodeSelectorComponent } from './components/language-code-selector/language-code-selector.component';
import { DataTableFilterPresetsComponent } from './components/data-table-filter-presets/data-table-filter-presets.component';
import { AddFilterPresetButtonComponent } from './components/data-table-filter-presets/add-filter-preset-button.component';
import { RenameFilterPresetDialogComponent } from './components/data-table-filter-presets/rename-filter-preset-dialog.component';
import { ActionBarDropdownMenuComponent } from './components/action-bar-dropdown-menu/action-bar-dropdown-menu.component';
import { DuplicateEntityDialogComponent } from './components/duplicate-entity-dialog/duplicate-entity-dialog.component';

const IMPORTS = [
    ClarityModule,
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    RouterModule,
    NgSelectModule,
    NgxPaginationModule,
    TranslateModule,
    OverlayModule,
    DragDropModule,
    A11yModule,
];

const DECLARATIONS = [
    ActionBarComponent,
    ActionBarLeftComponent,
    ActionBarRightComponent,
    ActionBarDropdownMenuComponent,
    AssetsComponent,
    AssetPreviewComponent,
    AssetPreviewDialogComponent,
    AssetSearchInputComponent,
    ConfigurableInputComponent,
    AffixedInputComponent,
    ChipComponent,
    CurrencyInputComponent,
    LocaleCurrencyNamePipe,
    CustomerLabelComponent,
    CustomFieldControlComponent,
    DataTableComponent,
    DataTableColumnComponent,
    FacetValueSelectorComponent,
    ItemsPerPageControlsComponent,
    PaginationControlsComponent,
    TableRowActionComponent,
    FacetValueChipComponent,
    FileSizePipe,
    FormFieldComponent,
    FormFieldControlDirective,
    FormItemComponent,
    ModalDialogComponent,
    PercentageSuffixInputComponent,
    DialogComponentOutletComponent,
    DialogButtonsDirective,
    DialogTitleDirective,
    SelectToggleComponent,
    LanguageSelectorComponent,
    RichTextEditorComponent,
    SimpleDialogComponent,
    TitleInputComponent,
    SentenceCasePipe,
    DropdownComponent,
    DropdownMenuComponent,
    SortPipe,
    DropdownTriggerDirective,
    DropdownItemDirective,
    OrderStateLabelComponent,
    FormattedAddressComponent,
    LabeledDataComponent,
    StringToColorPipe,
    ObjectTreeComponent,
    IfPermissionsDirective,
    IfMultichannelDirective,
    HasPermissionPipe,
    ActionBarItemsComponent,
    DisabledDirective,
    AssetFileInputComponent,
    AssetGalleryComponent,
    AssetPickerDialogComponent,
    EntityInfoComponent,
    DatetimePickerComponent,
    ChannelBadgeComponent,
    ChannelAssignmentControlComponent,
    ChannelLabelPipe,
    IfDefaultChannelActiveDirective,
    CustomFieldLabelPipe,
    CustomFieldDescriptionPipe,
    FocalPointControlComponent,
    AssetPreviewPipe,
    LinkDialogComponent,
    ExternalImageDialogComponent,
    TimeAgoPipe,
    DurationPipe,
    EmptyPlaceholderComponent,
    TimelineEntryComponent,
    HistoryEntryDetailComponent,
    EditNoteDialogComponent,
    ProductSelectorFormInputComponent,
    StateI18nTokenPipe,
    ProductVariantSelectorComponent,
    HelpTooltipComponent,
    CustomerGroupFormInputComponent,
    AddressFormComponent,
    LocaleDatePipe,
    LocaleCurrencyPipe,
    LocaleLanguageNamePipe,
    LocaleRegionNamePipe,
    TagSelectorComponent,
    ManageTagsDialogComponent,
    RelationSelectorDialogComponent,
    RelationCardComponent,
    StatusBadgeComponent,
    TabbedCustomFieldsComponent,
    UiExtensionPointComponent,
    CustomDetailComponentHostComponent,
    AssetPreviewLinksComponent,
    ProductMultiSelectorDialogComponent,
    ProductSearchInputComponent,
    ContextMenuComponent,
    RawHtmlDialogComponent,
    BulkActionMenuComponent,
    RadioCardComponent,
    RadioCardFieldsetComponent,
    DataTable2Component,
    DataTable2ColumnComponent,
    DataTableFiltersComponent,
    DataTableFilterLabelComponent,
    DataTableColumnPickerComponent,
    DataTable2SearchComponent,
    DataTableCustomFieldColumnComponent,
    SplitViewComponent,
    SplitViewLeftDirective,
    SplitViewRightDirective,
    PageComponent,
    CustomFilterComponentDirective,
    PageHeaderComponent,
    PageTitleComponent,
    PageHeaderDescriptionComponent,
    PageHeaderTabsComponent,
    PageBodyComponent,
    PageBlockComponent,
    PageEntityInfoComponent,
    LocalizedTextComponent,
    PageDetailLayoutComponent,
    PageDetailSidebarComponent,
    CardComponent,
    CardControlsDirective,
    ZoneSelectorComponent,
    ChartComponent,
    AssignToChannelDialogComponent,
    CurrencyCodeSelectorComponent,
    LanguageCodeSelectorComponent,
    DataTableFilterPresetsComponent,
    AddFilterPresetButtonComponent,
    RenameFilterPresetDialogComponent,
    DuplicateEntityDialogComponent,
];

const DYNAMIC_FORM_INPUTS = [
    TextFormInputComponent,
    PasswordFormInputComponent,
    NumberFormInputComponent,
    DateFormInputComponent,
    CurrencyFormInputComponent,
    BooleanFormInputComponent,
    SelectFormInputComponent,
    FacetValueFormInputComponent,
    DynamicFormInputComponent,
    RelationFormInputComponent,
    RelationAssetInputComponent,
    RelationProductInputComponent,
    RelationProductVariantInputComponent,
    RelationCustomerInputComponent,
    RelationCardPreviewDirective,
    RelationCardDetailDirective,
    RelationSelectorDialogComponent,
    RelationGenericInputComponent,
    TextareaFormInputComponent,
    RichTextFormInputComponent,
    JsonEditorFormInputComponent,
    HtmlEditorFormInputComponent,
    ProductMultiSelectorFormInputComponent,
    CombinationModeFormInputComponent,
    StructFormInputComponent,
];

@NgModule({
    imports: [IMPORTS],
    exports: [...IMPORTS, ...DECLARATIONS, ...DYNAMIC_FORM_INPUTS],
    declarations: [...DECLARATIONS, ...DYNAMIC_FORM_INPUTS],
    providers: [
        // This needs to be shared, since lazy-loaded
        // modules have their own entryComponents which
        // are unknown to the CoreModule instance of ModalService.
        // See https://github.com/angular/angular/issues/14324#issuecomment-305650763
        ModalService,
        CanDeactivateDetailGuard,
    ],
    schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class SharedModule {}
