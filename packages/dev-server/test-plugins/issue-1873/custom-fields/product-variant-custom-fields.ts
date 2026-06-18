import type { CustomFieldConfig } from '@vendure/core';
import { Asset } from '@vendure/core';

export const productVariantCustomFields: CustomFieldConfig[] = [
  // {
  //   type: 'int',
  //   name: 'costPrice',
  //   nullable: false,
  //   public: false,
  //   defaultValue: 0,
  //   label: [
  //     {
  //       languageCode: LanguageCode.en,
  //       value: 'Cost Price',
  //     },
  //   ],
  //   description: [
  //     {
  //       languageCode: LanguageCode.en,
  //       value: 'The cost price of this product',
  //     },
  //   ],
  // },
  {
    type: 'relation',
    name: 'tryonFrameAsset',
    nullable: true,
    entity: Asset,
    eager: true,
    public: true,
  },
  {
    type: 'relation',
    name: 'tryonTempleAsset',
    nullable: true,
    entity: Asset,
    eager: true,
    public: true,
  },
  {
    type: 'relation',
    name: 'visualFrameAsset',
    nullable: true,
    entity: Asset,
    eager: true,
    public: true,
  },
  // {
  //   type: 'relation',
  //   name: 'dimensionFrameAsset',
  //   nullable: true,
  //   entity: Asset,
  //   eager: true,
  //   public: true,
  // },
  // {
  //   type: 'relation',
  //   name: 'dimensionTempleAsset',
  //   nullable: true,
  //   entity: Asset,
  //   eager: true,
  //   public: true,
  // },
  // {
  //   type: 'text',
  //   name: 'tryonFrameModelConfig',
  //   nullable: true,
  //   public: true,
  //   label: [
  //     {
  //       languageCode: LanguageCode.en,
  //       value: 'Tryon Frame Model Config',
  //     },
  //   ],
  //   description: [
  //     {
  //       languageCode: LanguageCode.en,
  //       value: 'The tryon model json config data product variant',
  //     },
  //   ],
  // },
];
