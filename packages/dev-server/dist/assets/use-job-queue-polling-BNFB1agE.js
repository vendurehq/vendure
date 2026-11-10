import{r,u as m,g as E,a as A}from"./index-BcOoJppr.js";const L=5e3,T=3e4,P=500,_=4e3,O="job-queue-polling:",y=E(`
    query JobListForPolling($options: JobListOptions) {
        jobs(options: $options) {
            items {
                id
                createdAt
                state
            }
            totalItems
        }
    }
`),g=t=>`${O}${t}`,h=t=>{try{const n=sessionStorage.getItem(g(t));if(n)return JSON.parse(n)}catch{}return null},D=(t,n)=>sessionStorage.setItem(g(t),JSON.stringify(n)),f=t=>sessionStorage.removeItem(g(t));function w(t,n){const[l,i]=r.useState(!1),[R,S]=r.useState(0),o=r.useRef(null),s=r.useRef(null),a=r.useRef(n),I=r.useRef(!1);r.useEffect(()=>{a.current=n},[n]),r.useEffect(()=>{if(I.current)return;I.current=!0;const e=h(t);if(e&&Date.now()<e.expiresAt){o.current=e.startTime,S(0),i(!0);const c=e.expiresAt-Date.now();s.current=setTimeout(()=>{i(!1),o.current=null,f(t),a.current()},c)}else e&&f(t)},[t]);const b=l?Math.min(P*Math.pow(1.75,R),_):!1,{data:p}=m({queryKey:["jobQueuePolling",t],queryFn:()=>(S(e=>e+1),A.query(y,{options:{filter:{queueName:{eq:t}},sort:{createdAt:"DESC"},take:10}})),enabled:l,refetchInterval:b});r.useEffect(()=>{const e=o.current;if(!l||!e)return;const c=p?.jobs.items.filter(u=>u.createdAt>=e)??[];c.length>0&&c.every(u=>u.state!=="PENDING"&&u.state!=="RUNNING"&&u.state!=="RETRYING")&&(i(!1),o.current=null,f(t),s.current&&(clearTimeout(s.current),s.current=null),a.current())},[p,l,t]),r.useEffect(()=>()=>{s.current&&clearTimeout(s.current)},[]);const d=r.useCallback(()=>{s.current&&clearTimeout(s.current);const e=new Date(Date.now()-L).toISOString(),c=Date.now()+T;D(t,{startTime:e,expiresAt:c}),o.current=e,S(0),i(!0),s.current=setTimeout(()=>{i(!1),o.current=null,f(t),a.current()},T)},[t]);return{isPolling:l,startPolling:d}}export{w as u};
