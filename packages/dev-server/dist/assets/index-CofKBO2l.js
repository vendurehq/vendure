import{y as h,j as e,T as v,g as m,z as f,E as y,p as g,t as p,a as x,L as b,r as I,B as j,h as k,x as L}from"./index-BcOoJppr.js";import"./manage-languages-dialog-vxwm_3Rz.js";import"./login-form-B_F-5zTI.js";import"./channel-selector-DU961I5x.js";import"./country-selector-55Xe5yyb.js";import"./customer-address-form-C0-vebuL.js";import"./customer-selector-Es2yzNl_.js";import"./history-entry-extensions-DBzSOQ9X.js";import"./language-selector-CMk9Rgel.js";import"./product-variant-selector-y2J54kg_.js";import"./role-selector-taykVS-z.js";import"./seller-selector-DLLBgaHb.js";import"./tax-category-selector-BtHVVe2w.js";import"./zone-selector-vuMpw-Oi.js";import"./sidebar-context-CzHTwxQO.js";import"./common-operations-BdzNkZJM.js";import"./use-job-queue-polling-BNFB1agE.js";import{L as a}from"./labeled-data-CpAx7Ly8.js";import{L as T}from"./list-page-0RcighZE.js";import{D as C}from"./data-table-bulk-action-item-luoYiEPG.js";import{D as N}from"./download-DhDT2r_k.js";import"./eye-D4Nkaf3R.js";import"./form-field-wrapper-T-_M8wYL.js";const B=[["path",{d:"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z",key:"1rqfz7"}],["path",{d:"M14 2v4a2 2 0 0 0 2 2h4",key:"tnqrlb"}],["path",{d:"m9 15 2 2 4-4",key:"1grp1n"}]],E=h("FileCheck",B),w={id:"invoice-info",title:e.jsx(v,{id:"ZEKzjL"}),location:{pageId:"order-detail",column:"side",position:{blockId:"main-form",order:"after"}},shouldRender:i=>!!i.entity?.customFields?.invoiceRequired,component:({context:i})=>{const t=i.entity?.customFields;return t?e.jsxs("div",{className:"space-y-2",children:[e.jsx(a,{label:"Invoice Type",children:t.invoiceType||"-"}),e.jsx(a,{label:"Invoice Title",children:t.invoiceTitle||"-"}),e.jsx(a,{label:"Tax Number",children:t.invoiceTaxNumber||"-"}),e.jsx(a,{label:"Email",children:t.invoiceEmail||"-"}),t.invoiceType==="special"&&e.jsxs(e.Fragment,{children:[e.jsx(a,{label:"Company Address",children:t.invoiceCompanyAddress||"-"}),e.jsx(a,{label:"Company Phone",children:t.invoiceCompanyPhone||"-"}),e.jsx(a,{label:"Bank Name",children:t.invoiceBankName||"-"}),e.jsx(a,{label:"Bank Account",children:t.invoiceBankAccount||"-"})]})]}):null}},A=m(`
    mutation BulkIssueInvoices($ids: [ID!]!) {
        bulkIssueInvoices(ids: $ids) {
            id
            status
            invoiceNo
        }
    }
`),q=({selection:i,table:s})=>{const{refetchPaginatedList:t}=f(),{_:o}=y(),d=i.filter(r=>r.status==="pending"),c=d.length,{mutate:u,isPending:l}=g({mutationFn:async()=>{const r=await Promise.allSettled(d.map(n=>x.mutate(A,{ids:[n.id]})));return{fulfilled:r.filter(n=>n.status==="fulfilled").length,rejected:r.filter(n=>n.status==="rejected").length}},onSuccess:({fulfilled:r,rejected:n})=>{r>0&&p.success(o({id:"kc5ga2",values:{fulfilled:r}})),n>0&&p.error(o({id:"9aEf7O",values:{rejected:n}})),t(),s.resetRowSelection()}});return c===0?null:e.jsx(C,{requiresPermission:["UpdateOrder"],onClick:()=>u(),disabled:l,label:l?e.jsxs("span",{className:"flex items-center gap-2",children:[e.jsx(b,{className:"h-3.5 w-3.5 animate-spin"}),o({id:"uXUTG4"})]}):o({id:"hz4Q6t",values:{count:c}}),confirmationText:o({id:"UubyOU",values:{count:c}}),icon:E})},P=m(`
    query ExportInvoicesCsv {
        exportInvoicesCsv
    }
`);function R(){const[i,s]=I.useState(!1),t=async()=>{s(!0);try{const d=(await x.query(P)).exportInvoicesCsv,c=new Blob([d],{type:"text/csv;charset=utf-8;"}),u=URL.createObjectURL(c),l=document.createElement("a");l.href=u,l.download=`invoices-${new Date().toISOString().slice(0,10)}.csv`,l.click(),URL.revokeObjectURL(u),p.success("Export succeeded")}catch(o){p.error(o?.message??"Export failed")}finally{s(!1)}};return e.jsxs(j,{type:"button",onClick:t,disabled:i,variant:"secondary",children:[i?e.jsx(b,{className:"mr-2 h-4 w-4 animate-spin"}):e.jsx(N,{className:"mr-2 h-4 w-4"}),"Export CSV"]})}const D=m(`
    query GetInvoices($options: InvoiceListOptions) {
        invoices(options: $options) {
            items {
                id
                invoiceNo
                title
                taxNumber
                status
                invoiceType
                amount
                customerId
                orderIds
                createdAt
                issuedAt
                reversedAt
            }
            totalItems
        }
    }
`),F={pending:"bg-yellow-100 text-yellow-800",issued:"bg-green-100 text-green-800",reversed:"bg-gray-100 text-gray-700",partially_reversed:"bg-blue-100 text-blue-700",voided:"bg-red-100 text-red-700",failed:"bg-red-100 text-red-700"},O={pending:"待开票",issued:"已开具",reversed:"已红冲",partially_reversed:"部分红冲",voided:"已作废",failed:"开票失败"};function S(i){switch(i){case"special":return"专用发票";case"electronic":return"电子发票";default:return"普通发票"}}const U={navMenuItem:{sectionId:"sales",id:"invoices",url:"/invoices",title:"发票中心",requiresPermission:["ReadOrder"]},path:"/invoices",loader:()=>({breadcrumb:"发票中心"}),component:i=>e.jsx(T,{pageId:"invoice-list",title:e.jsx(v,{id:"mN3qAt"}),listQuery:D,route:i,defaultSort:[{id:"createdAt",desc:!0}],defaultVisibility:{taxNumber:!1,customerId:!1,orderIds:!1},facetedFilters:{status:{title:"状态",options:[{label:"待开票",value:"pending"},{label:"已开具",value:"issued"},{label:"已红冲",value:"reversed"},{label:"部分红冲",value:"partially_reversed"},{label:"已作废",value:"voided"},{label:"开票失败",value:"failed"}]},invoiceType:{title:"发票类型",options:[{label:"普通发票",value:"ordinary"},{label:"专用发票",value:"special"},{label:"电子发票",value:"electronic"}]}},bulkActions:[{component:q}],customizeColumns:{status:{header:"状态",cell:({row:s})=>{const t=s.original.status;return e.jsx("span",{className:`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${F[t]||""}`,children:O[t]||t})}},invoiceType:{header:"类型",cell:({row:s})=>e.jsx("span",{children:S(s.original.invoiceType)})},amount:{header:"金额(元)",cell:({row:s})=>e.jsxs("span",{children:["¥",(s.original.amount/100).toFixed(2)]})},customerId:{header:"客户ID",cell:({row:s})=>e.jsx("span",{children:s.original.customerId})},orderIds:{header:"关联订单",cell:({row:s})=>e.jsx("span",{children:s.original.orderIds.join(", ")})}},children:e.jsx(k,{children:e.jsx(R,{})})})};L({routes:[U],pageBlocks:[w]});
