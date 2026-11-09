import{F as c,j as e,T as d,g as s,d as m,x as u}from"./index-BEWB-Tpc.js";import"./manage-languages-dialog-DHH1CX1B.js";import"./login-form--sKT3uaa.js";import"./channel-selector-CjlI3I-E.js";import"./country-selector-CrUSS7-U.js";import"./customer-address-form-xPoHsKeW.js";import"./customer-selector-BwblO224.js";import"./history-entry-extensions-BN58gOF7.js";import"./language-selector-DcnAQ26p.js";import"./product-variant-selector-Cm9RuJrE.js";import"./role-selector-y8H1yH-z.js";import"./seller-selector-DVIOdKp7.js";import"./tax-category-selector-CY-uoW2p.js";import"./zone-selector-CVjynmwB.js";import"./sidebar-context-Jw8BEXxL.js";import"./common-operations-MAx-dweV.js";import"./use-job-queue-polling-AYm6bnNF.js";import{L as r}from"./labeled-data-x_b-VMwM.js";import{D as o}from"./detail-page-button-C5ZVdUuQ.js";import{D as p}from"./detail-page-CQyY6w0-.js";import{L as h}from"./list-page-B2i9jzml.js";import"./eye-LjRQVh9Q.js";import"./form-field-wrapper-Cvabj0WC.js";const f={id:"flash-sale-info",title:e.jsx(d,{id:"OHQagY"}),location:{pageId:"order-detail",column:"side",position:{blockId:"group-buy-info",order:"after"}},shouldRender:i=>!!i.entity?.customFields?.flashSaleActivityId,component:({context:i})=>{const a=i.entity?.customFields,{formatDate:l}=c();return a?.flashSaleActivityId?e.jsxs("div",{className:"space-y-2",children:[e.jsx(r,{label:"Activity ID",children:e.jsx(o,{href:`/flash-sale-activities/${a.flashSaleActivityId}`,label:String(a.flashSaleActivityId)})}),a.flashSaleStartAt&&e.jsx(r,{label:"Start At",children:l(a.flashSaleStartAt)}),a.flashSaleEndAt&&e.jsx(r,{label:"End At",children:l(a.flashSaleEndAt)})]}):null}},n=s(`
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
