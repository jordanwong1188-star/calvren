interface PageContext { request: Request; env: { CALVREN_BACKEND_URL?: string }; next(): Promise<Response>; }
export async function onRequest(context: PageContext): Promise<Response> {
  const url=new URL(context.request.url);
  const form=url.pathname==="/"&&context.request.method==="POST";
  if(!form&&!url.pathname.startsWith("/api/"))return context.next();
  try{
    const base=new URL(context.env.CALVREN_BACKEND_URL||"https://xjfsukhfmkgvlfpgjevg.supabase.co/functions/v1/calvren");
    if(base.protocol!=="https:"||base.username||base.password||base.search||base.hash||!base.hostname.endsWith(".supabase.co")||base.pathname!=="/functions/v1/calvren")throw new Error();
    const path=form?"/forms":url.pathname;
    const headers=new Headers(context.request.headers);
    for(const name of ["host","cookie","cf-connecting-ip","x-forwarded-for","x-calvren-client-ip"])headers.delete(name);
    headers.set("x-calvren-client-ip",context.request.headers.get("cf-connecting-ip")||"unknown");
    const init: RequestInit & {duplex?:"half"} = {method:context.request.method,headers,
      ...(["GET","HEAD"].includes(context.request.method)?{}:{body:context.request.body,duplex:"half" as const}),redirect:"manual"};
    const response=await fetch(new Request(base.href+path+url.search,init));
    // Redirects must never carry an operator/client token to another host.
    if(response.status>=300&&response.status<400)throw new Error();
    const result=new Response(response.body,response);
    result.headers.set("Cache-Control","no-store");
    result.headers.set("X-Content-Type-Options","nosniff");
    result.headers.set("X-Frame-Options","DENY");
    return result;
  }catch{return new Response(JSON.stringify({error:"Calvren’s backend is temporarily unavailable. Please try again or email Jordan."}),{status:503,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});}
}
