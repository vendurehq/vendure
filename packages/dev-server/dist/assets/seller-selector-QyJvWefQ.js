import{E as i,j as l,du as n,T as o,g as a}from"./index-CLu5rDeH.js";const r=a(`
    query SellerList($options: SellerListOptions) {
        sellers(options: $options) {
            items {
                id
                name
            }
            totalItems
        }
    }
`);function u(e){const{_:s}=i();return l.jsx(n,{config:{listQuery:r,idKey:"id",labelKey:"name",placeholder:s({id:"ZPVB4K"})},selectorLabel:e.label??l.jsx(o,{id:"mj8NP+"}),value:e.value??void 0,onChange:t=>{typeof t=="string"&&e.onChange(t)},disabled:e.readOnly})}export{u as S};
