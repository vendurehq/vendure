import{g as n,j as e,T as d,u as c,a as m,x as p}from"./index-BEWB-Tpc.js";import"./manage-languages-dialog-DHH1CX1B.js";import"./login-form--sKT3uaa.js";import"./channel-selector-CjlI3I-E.js";import"./country-selector-CrUSS7-U.js";import"./customer-address-form-xPoHsKeW.js";import"./customer-selector-BwblO224.js";import"./history-entry-extensions-BN58gOF7.js";import"./language-selector-DcnAQ26p.js";import"./product-variant-selector-Cm9RuJrE.js";import"./role-selector-y8H1yH-z.js";import"./seller-selector-DVIOdKp7.js";import"./tax-category-selector-CY-uoW2p.js";import"./zone-selector-CVjynmwB.js";import"./sidebar-context-Jw8BEXxL.js";import"./common-operations-MAx-dweV.js";import"./use-job-queue-polling-AYm6bnNF.js";import{L as u}from"./list-page-B2i9jzml.js";import{L as a}from"./labeled-data-x_b-VMwM.js";import"./eye-LjRQVh9Q.js";import"./form-field-wrapper-Cvabj0WC.js";const g=n(`
    query GetReviews {
        reviews {
            items {
                id
                customerId
                productId
                rating
                content
                status
                createdAt
            }
            totalItems
        }
    }
`),x={navMenuItem:{sectionId:"catalog",id:"reviews",url:"/reviews",title:"评价管理",requiresPermission:["ReadCatalog"]},path:"/reviews",loader:()=>({breadcrumb:"评价管理"}),component:i=>e.jsx(u,{pageId:"review-list",title:e.jsx(d,{id:"rVg7PG"}),listQuery:g,route:i,customizeColumns:{rating:{header:"评分",cell:({row:r})=>{const t=Number(r.original.rating)||0;return e.jsxs("span",{className:"text-sm","aria-label":`${t}/5`,children:[e.jsx("span",{className:"text-yellow-500",children:"★".repeat(t)}),e.jsx("span",{className:"text-muted-foreground",children:"☆".repeat(5-t)})]})}},status:{header:"状态",cell:({row:r})=>{const t=r.original.status,o={pending:"bg-yellow-100 text-yellow-800",approved:"bg-green-100 text-green-800",rejected:"bg-red-100 text-red-800"};return e.jsx("span",{className:`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${o[t]||""}`,children:t})}}}})},v=n(`
    query GetReviewStats($productId: ID!) {
        reviewStats(productId: $productId) {
            totalCount
            goodRate
            averageRating
        }
    }
`),w={id:"review-stats",title:e.jsx(d,{id:"wyYOzQ"}),location:{pageId:"product-detail",column:"side",position:{blockId:"enabled-toggle",order:"after"}},shouldRender:()=>!0,component:({context:i})=>{const t=i.entity?.id,{data:o,isLoading:l}=c({queryKey:["reviewStats",t],queryFn:()=>m.query(v,{productId:String(t)}),enabled:!!t}),s=o?.reviewStats;return l?e.jsx("div",{className:"text-sm text-muted-foreground",children:"加载中..."}):s?e.jsxs("div",{className:"space-y-2",children:[e.jsx(a,{label:"评价总数",children:s.totalCount}),e.jsxs(a,{label:"好评率",children:[s.goodRate,"%"]}),e.jsx(a,{label:"平均评分",children:s.averageRating})]}):e.jsx("div",{className:"text-sm text-muted-foreground",children:"暂无评价数据"})}};p({routes:[x],pageBlocks:[w]});
