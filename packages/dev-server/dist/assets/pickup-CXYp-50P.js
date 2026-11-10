import{u as i,j as s,a as l}from"./index-BcOoJppr.js";const d=`
    query GetPickupLocations {
        pickupLocations {
            items {
                id
                name
                type
                address
                phoneNumber
                businessHours
                isPublic
                province
                city
                district
                street
            }
            totalItems
        }
    }
`;function p({channelId:r}){const{data:c,isLoading:a}=i({queryKey:["pickupLocations",r],queryFn:()=>l.query(d,{})}),t=c?.pickupLocations?.items??[];return s.jsxs("div",{children:[s.jsx("h2",{className:"mb-2 text-lg font-semibold",children:"自提点"}),a?s.jsx("p",{className:"text-muted-foreground",children:"加载中…"}):t.length===0?s.jsx("p",{className:"text-muted-foreground",children:"暂无自提点。"}):s.jsxs("table",{className:"w-full text-sm",children:[s.jsx("thead",{children:s.jsxs("tr",{className:"border-b text-left text-muted-foreground",children:[s.jsx("th",{className:"py-1 pr-2",children:"名称"}),s.jsx("th",{className:"py-1 pr-2",children:"类型"}),s.jsx("th",{className:"py-1 pr-2",children:"地址"}),s.jsx("th",{className:"py-1 pr-2",children:"电话"}),s.jsx("th",{className:"py-1 pr-2",children:"营业时间"}),s.jsx("th",{className:"py-1 pr-2",children:"公开"})]})}),s.jsx("tbody",{children:t.map(e=>s.jsxs("tr",{className:"border-b",children:[s.jsx("td",{className:"py-1 pr-2",children:e.name}),s.jsx("td",{className:"py-1 pr-2",children:e.type}),s.jsx("td",{className:"py-1 pr-2",children:e.address}),s.jsx("td",{className:"py-1 pr-2",children:e.phoneNumber??"—"}),s.jsx("td",{className:"py-1 pr-2",children:e.businessHours??"—"}),s.jsx("td",{className:"py-1 pr-2",children:e.isPublic?"是":"否"})]},e.id))})]})]})}export{p as default};
