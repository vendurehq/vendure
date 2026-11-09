import{u as n,j as e,a as d}from"./index-BEWB-Tpc.js";const c=`
    query GetShippingTemplates {
        shippingTemplates {
            items {
                id
                name
                description
                code
                fulfillmentHandler
                isGlobal
            }
            totalItems
        }
    }
`,p=`
    query GetShippingProfiles {
        shippingProfiles {
            items {
                id
                name
                description
                code
                isGlobal
                freeShippingThreshold
            }
            totalItems
        }
    }
`;function h({channelId:l}){const r=n({queryKey:["shippingTemplates",l],queryFn:()=>d.query(c,{})}),t=n({queryKey:["shippingProfiles",l],queryFn:()=>d.query(p,{})}),i=r.data?.shippingTemplates?.items??[],a=t.data?.shippingProfiles?.items??[];return e.jsxs("div",{className:"space-y-6",children:[e.jsxs("section",{children:[e.jsx("h2",{className:"mb-2 text-lg font-semibold",children:"配送模板（ShippingTemplate）"}),r.isLoading?e.jsx("p",{className:"text-muted-foreground",children:"加载中…"}):i.length===0?e.jsx("p",{className:"text-muted-foreground",children:"暂无配送模板。"}):e.jsxs("table",{className:"w-full text-sm",children:[e.jsx("thead",{children:e.jsxs("tr",{className:"border-b text-left text-muted-foreground",children:[e.jsx("th",{className:"py-1 pr-2",children:"名称"}),e.jsx("th",{className:"py-1 pr-2",children:"Code"}),e.jsx("th",{className:"py-1 pr-2",children:"履约方式"}),e.jsx("th",{className:"py-1 pr-2",children:"全局"})]})}),e.jsx("tbody",{children:i.map(s=>e.jsxs("tr",{className:"border-b",children:[e.jsx("td",{className:"py-1 pr-2",children:s.name}),e.jsx("td",{className:"py-1 pr-2",children:s.code}),e.jsx("td",{className:"py-1 pr-2",children:s.fulfillmentHandler}),e.jsx("td",{className:"py-1 pr-2",children:s.isGlobal?"是":"否"})]},s.id))})]})]}),e.jsxs("section",{children:[e.jsx("h2",{className:"mb-2 text-lg font-semibold",children:"配送方案（ShippingProfile）"}),t.isLoading?e.jsx("p",{className:"text-muted-foreground",children:"加载中…"}):a.length===0?e.jsx("p",{className:"text-muted-foreground",children:"暂无配送方案。"}):e.jsxs("table",{className:"w-full text-sm",children:[e.jsx("thead",{children:e.jsxs("tr",{className:"border-b text-left text-muted-foreground",children:[e.jsx("th",{className:"py-1 pr-2",children:"名称"}),e.jsx("th",{className:"py-1 pr-2",children:"Code"}),e.jsx("th",{className:"py-1 pr-2",children:"全局"}),e.jsx("th",{className:"py-1 pr-2",children:"包邮阈值"})]})}),e.jsx("tbody",{children:a.map(s=>e.jsxs("tr",{className:"border-b",children:[e.jsx("td",{className:"py-1 pr-2",children:s.name}),e.jsx("td",{className:"py-1 pr-2",children:s.code}),e.jsx("td",{className:"py-1 pr-2",children:s.isGlobal?"是":"否"}),e.jsx("td",{className:"py-1 pr-2",children:s.freeShippingThreshold??"—"})]},s.id))})]})]})]})}export{h as default};
