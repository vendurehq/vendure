import{E as u,u as r,j as a,bq as d,de as p,g as h,a as m}from"./index-BcOoJppr.js";const q=h(`
    query channels($options: ChannelListOptions) {
        channels(options: $options) {
            items {
                id
                code
            }
        }
    }
`);function C(n){const{value:t,onChange:o,multiple:l}=n,{_:s}=u(),{data:i}=r({queryKey:["channels"],queryFn:()=>m.query(q,{}),staleTime:1e3*60*5}),c=(i?.channels.items??[]).map(e=>({value:e.id,label:e.code,display:a.jsx(d,{code:e.code})}));return a.jsx(p,{value:t,onChange:o,multiple:l,items:c,placeholder:s({id:"Ce8q3L"}),searchPlaceholder:s({id:"PLeYjq"})})}export{C};
