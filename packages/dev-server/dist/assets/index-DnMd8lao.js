import{g as n,j as e,T as d,u as c,a as m,x as p}from"./index-BcOoJppr.js";import"./manage-languages-dialog-vxwm_3Rz.js";import"./login-form-B_F-5zTI.js";import"./channel-selector-DU961I5x.js";import"./country-selector-55Xe5yyb.js";import"./customer-address-form-C0-vebuL.js";import"./customer-selector-Es2yzNl_.js";import"./history-entry-extensions-DBzSOQ9X.js";import"./language-selector-CMk9Rgel.js";import"./product-variant-selector-y2J54kg_.js";import"./role-selector-taykVS-z.js";import"./seller-selector-DLLBgaHb.js";import"./tax-category-selector-BtHVVe2w.js";import"./zone-selector-vuMpw-Oi.js";import"./sidebar-context-CzHTwxQO.js";import"./common-operations-BdzNkZJM.js";import"./use-job-queue-polling-BNFB1agE.js";import{L as u}from"./list-page-0RcighZE.js";import{L as a}from"./labeled-data-CpAx7Ly8.js";import"./eye-D4Nkaf3R.js";import"./form-field-wrapper-T-_M8wYL.js";const g=n(`
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
