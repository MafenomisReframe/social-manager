// Social Manager API foundation. No tenant data is exposed until authentication is implemented.
const headers = {"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
const json = (body,status=200)=>Response.json(body,{status,headers});
export default {
  async fetch(request,env) {
    const url=new URL(request.url);
    if(url.pathname==="/api/health" && request.method==="GET") {
      try {
        if(!env.DB) return json({status:"unavailable",database:"binding_missing"},503);
        await env.DB.prepare("SELECT 1 AS ok").first();
        return json({status:"ok",database:"connected"});
      } catch(e) {
        console.error("Health check failed",e);
        return json({status:"unavailable",database:"error"},503);
      }
    }
    if(url.pathname.startsWith("/api/")) {
      return json({error:"Unauthorized",message:"Accesso protetto: autenticazione non ancora configurata"},401);
    }
    return env.ASSETS.fetch(request);
  }
};
