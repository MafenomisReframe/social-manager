export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      return Response.json({error:"API non ancora attive: autenticazione richiesta"}, {status:503,headers:{"Cache-Control":"no-store"}});
    }
    return env.ASSETS.fetch(request);
  }
};
