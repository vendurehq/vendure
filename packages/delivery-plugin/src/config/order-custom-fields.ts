import { CustomFields } from '@vendure/core';

export const deliveryOrderCustomFields: CustomFields = {
  Order: [
    { name: 'deliveryStaffId',    type: 'string',  nullable: true },
    { name: 'deliveryStatus',     type: 'string',  nullable: true },
    { name: 'assignedAt',         type: 'datetime', nullable: true },
    // 已取餐时间（骑手/自营快递确认取餐写一次）：在途时钟只认这个锚点，缺失时不回退 createdAt
    { name: 'pickedUpAt',         type: 'datetime', nullable: true },
    { name: 'deliveredAt',        type: 'datetime', nullable: true },
    { name: 'deliveryPhotos',     type: 'string',  list: true, nullable: true },
    { name: 'deliveryNote',       type: 'string',  nullable: true },
    { name: 'exceptionType',      type: 'string',  nullable: true },
    { name: 'exceptionNote',      type: 'string',  nullable: true },
    { name: 'exceptionPhotos',    type: 'string',  list: true, nullable: true },
  ],
};
