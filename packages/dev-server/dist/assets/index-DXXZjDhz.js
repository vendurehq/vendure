import{F as c,j as e,T as d,g as s,d as m,x as u}from"./index-BcOoJppr.js";import"./manage-languages-dialog-vxwm_3Rz.js";import"./login-form-B_F-5zTI.js";import"./channel-selector-DU961I5x.js";import"./country-selector-55Xe5yyb.js";import"./customer-address-form-C0-vebuL.js";import"./customer-selector-Es2yzNl_.js";import"./history-entry-extensions-DBzSOQ9X.js";import"./language-selector-CMk9Rgel.js";import"./product-variant-selector-y2J54kg_.js";import"./role-selector-taykVS-z.js";import"./seller-selector-DLLBgaHb.js";import"./tax-category-selector-BtHVVe2w.js";import"./zone-selector-vuMpw-Oi.js";import"./sidebar-context-CzHTwxQO.js";import"./common-operations-BdzNkZJM.js";import"./use-job-queue-polling-BNFB1agE.js";import{L as r}from"./labeled-data-CpAx7Ly8.js";import{D as o}from"./detail-page-button-NrwVO4AW.js";import{D as p}from"./detail-page-vk-BUqJn.js";import{L as h}from"./list-page-0RcighZE.js";import"./eye-D4Nkaf3R.js";import"./form-field-wrapper-T-_M8wYL.js";const f={id:"flash-sale-info",title:e.jsx(d,{id:"OHQagY"}),location:{pageId:"order-detail",column:"side",position:{blockId:"group-buy-info",order:"after"}},shouldRender:i=>!!i.entity?.customFields?.flashSaleActivityId,component:({context:i})=>{const a=i.entity?.customFields,{formatDate:l}=c();return a?.flashSaleActivityId?e.jsxs("div",{className:"space-y-2",children:[e.jsx(r,{label:"Activity ID",children:e.jsx(o,{href:`/flash-sale-activities/${a.flashSaleActivityId}`,label:String(a.flashSaleActivityId)})}),a.flashSaleStartAt&&e.jsx(r,{label:"Start At",children:l(a.flashSaleStartAt)}),a.flashSaleEndAt&&e.jsx(r,{label:"End At",children:l(a.flashSaleEndAt)})]}):null}},n=s(`
    query GetFlashSaleDetail($id: ID!) {
        flashSaleActivity(id: $id) {
            id
            name
            startAt
            endAt
            flashPrice
            totalStock
            soldCount
            limitPerUser
            status
            createdAt
            updatedAt
        }
    }
`),S=s(`
    mutation CreateFlashSaleActivity($input: CreateFlashSaleActivityInput!) {
        createFlashSaleActivity(input: $input) {
            id
        }
    }
`),A=s(`
    mutation UpdateFlashSaleActivity($input: UpdateFlashSaleActivityInput!) {
        updateFlashSaleActivity(input: $input) {
            id
        }
    }
`),g={path:"/flash-sale-activities/$id",loader:m({queryDocument:n,breadcrumb:(i,t)=>[{path:"/flash-sale-activities",label:"Flash Sale"},i?"New":t?.name]}),component:i=>e.jsx(p,{pageId:"flash-sale-detail",queryDocument:n,createDocument:S,updateDocument:A,route:i,title:t=>t.name,setValuesForUpdate:t=>({id:t.id,name:t.name,startAt:t.startAt,endAt:t.endAt,flashPrice:t.flashPrice,totalStock:t.totalStock,limitPerUser:t.limitPerUser,status:t.status})})},x=s(`
    query GetFlashSaleActivities($options: Json) {
        flashSaleActivities(options: $options) {
            items {
                id
                name
                status
                flashPrice
                totalStock
                soldCount
                limitPerUser
                startAt
                endAt
            }
            totalItems
        }
    }
`),y={navMenuItem:{sectionId:"marketing",id:"flash-sale-activities",url:"/flash-sale-activities",title:"Flash Sale",requiresPermission:["ReadPromotion"]},path:"/flash-sale-activities",loader:()=>({breadcrumb:"Flash Sale"}),component:i=>e.jsx(h,{pageId:"flash-sale-list",title:e.jsx(d,{id:"y9qrqs"}),listQuery:x,route:i,defaultVisibility:{limitPerUser:!1},customizeColumns:{id:{header:"ID",cell:({row:t})=>e.jsx(o,{id:t.original.id,label:t.original.id})},name:{header:"Name",cell:({row:t})=>e.jsx(o,{id:t.original.id,label:t.original.name})},status:{header:"Status",cell:({row:t})=>{const a=t.original.status,l={upcoming:"bg-yellow-100 text-yellow-800",active:"bg-green-100 text-green-800",ended:"bg-gray-100 text-gray-800"};return e.jsx("span",{className:`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${l[a]||""}`,children:a})}}}})};u({routes:[y,g],pageBlocks:[f]});
