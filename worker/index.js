const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
const cors=(request,env)=>({ "access-control-allow-origin": env.APP_ORIGIN || new URL(request.url).origin, "access-control-allow-methods":"GET,POST,PUT,OPTIONS", "access-control-allow-headers":"content-type,authorization", "vary":"Origin" });
function withCors(response,headers){const h=new Headers(response.headers);for(const [k,v] of Object.entries(headers))h.set(k,v);return new Response(response.body,{status:response.status,headers:h})}
async function providerToken(env){
  if(!env.SHAREHUB_EMAIL||!env.SHAREHUB_PASSWORD)throw new Error("NEPSE data provider is not configured. Add ShareHub API credentials as Worker secrets.");
  let access=await env.DB.prepare("SELECT value FROM app_settings WHERE key='provider_access_token'").first();
  let refresh=await env.DB.prepare("SELECT value FROM app_settings WHERE key='provider_refresh_token'").first();
  let expires=await env.DB.prepare("SELECT value FROM app_settings WHERE key='provider_access_expiry'").first();
  if(access&&refresh&&expires&&Date.parse(expires.value)>Date.now()+60000)return access.value;
  const url="https://sharehubnepal.com/account/api/v1/auth/login/refresh";
  let payload;
  if(refresh&&access){
    const r=await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({accessToken:access.value,refreshToken:refresh.value})});
    if(r.ok)payload=await r.json();
  }
  if(!payload?.success){
    const r=await fetch("https://sharehubnepal.com/account/api/v1/auth/login/email",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:env.SHAREHUB_EMAIL,password:env.SHAREHUB_PASSWORD,useOnCookies:false})});
    if(!r.ok)throw new Error("ShareHub login failed ("+r.status+"). Check provider credentials and licence.");
    payload=await r.json();
  }
  const d=payload.data||{};
  if(!d.accessToken||!d.refreshToken)throw new Error("Provider did not return valid access and refresh tokens.");
  await env.DB.batch([
    env.DB.prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('provider_access_token',?)").bind(d.accessToken),
    env.DB.prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('provider_refresh_token',?)").bind(d.refreshToken),
    env.DB.prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('provider_access_expiry',?)").bind(d.accessTokenExpiration||new Date(Date.now()+25*60000).toISOString())
  ]);
  return d.accessToken;
}
async function providerGet(env,path){
  const token=await providerToken(env);
  let r=await fetch("https://sharehubnepal.com/data/api/v1/nepse-data"+path,{headers:{authorization:"Bearer "+token}});
  if(r.status===401){await env.DB.batch(["provider_access_token","provider_refresh_token","provider_access_expiry"].map(k=>env.DB.prepare("DELETE FROM app_settings WHERE key=?").bind(k)));return providerGet(env,path)}
  if(!r.ok)throw new Error("Market data provider returned HTTP "+r.status);
  const body=await r.json();if(!body.success)throw new Error(body.message||"Market data provider error");return body.data;
}
function calcRsi(closes,period=14){if(closes.length<period+1)return null;let gain=0,loss=0;for(let i=closes.length-period;i<closes.length;i++){const d=closes[i]-closes[i-1];if(d>0)gain+=d;else loss-=d}if(loss===0)return 100;const rs=(gain/period)/(loss/period);return 100-100/(1+rs)}
function sma(a,n){return a.length<n?null:a.slice(-n).reduce((s,x)=>s+x,0)/n}
function emaSeries(a,n){if(a.length<n)return [];const k=2/(n+1);let e=a.slice(0,n).reduce((s,x)=>s+x,0)/n;const out=[e];for(let i=n;i<a.length;i++){e=a[i]*k+e*(1-k);out.push(e)}return out}
function technicalAlerts(symbol,candles){
  const rows=candles.slice().sort((a,b)=>a.time-b.time);const c=rows.map(x=>Number(x.close)).filter(Number.isFinite);if(c.length<35)return [];
  const last=c.at(-1),rsi=calcRsi(c),sma20=sma(c,20),sma50=sma(c,50),e12=emaSeries(c,12),e26=emaSeries(c,26);
  const macd=e12.length&&e26.length?e12.at(-1)-e26.at(-1):null;
  const out=[];
  if(rsi!==null&&rsi>=70)out.push({type:"RSI_OVERBOUGHT",severity:"caution",message:"RSI "+rsi.toFixed(1)+" indicates an overbought condition; review position and risk.",value:rsi});
  if(rsi!==null&&rsi<=30)out.push({type:"RSI_OVERSOLD",severity:"watch",message:"RSI "+rsi.toFixed(1)+" indicates an oversold condition; not a buy recommendation.",value:rsi});
  if(sma20!==null&&last<sma20)out.push({type:"BELOW_SMA20",severity:"caution",message:"Close is below the 20-day moving average.",value:last});
  if(sma50!==null&&last<sma50)out.push({type:"BELOW_SMA50",severity:"caution",message:"Close is below the 50-day moving average.",value:last});
  if(macd!==null&&macd<0)out.push({type:"MACD_NEGATIVE",severity:"watch",message:"MACD line is below zero; check trend confirmation.",value:macd});
  return out;
}
async function syncMarket(env){
  const held=await env.DB.prepare("SELECT symbol FROM holdings").all();const symbols=held.results.map(x=>x.symbol);
  if(!symbols.length)return {synced:0,alerts:0};
  const [quotes,now]=await Promise.all([providerGet(env,"/stock-prices"),Promise.resolve(new Date().toISOString())]);
  const quoteMap=new Map((Array.isArray(quotes)?quotes:[]).map(q=>[q.symbol,q]));
  let synced=0,alertCount=0;
  for(const symbol of symbols){
    const q=quoteMap.get(symbol);if(q&&Number.isFinite(Number(q.ltp))){
      await env.DB.prepare("INSERT OR REPLACE INTO market_quotes(symbol,ltp,change_percent,as_of,source) VALUES(?,?,?,?,?)").bind(symbol,Number(q.ltp),Number(q.changePercent||0),q.lastUpdatedTime||now,"ShareHub").run();synced++;
    }
    try{
      const history=await providerGet(env,"/price-history/"+encodeURIComponent(symbol)+"?time=1Y");
      const candles=Array.isArray(history)?history:[];
      const batch=[];
      for(const x of candles){const ts=typeof x.time==="number"?new Date(x.time).toISOString():String(x.time);if([x.open,x.high,x.low,x.close].every(v=>Number.isFinite(Number(v))))batch.push(env.DB.prepare("INSERT OR REPLACE INTO price_history(symbol,candle_time,open,high,low,close,volume,source) VALUES(?,?,?,?,?,?,?,?)").bind(symbol,ts,Number(x.open),Number(x.high),Number(x.low),Number(x.close),Number(x.volume||0),"ShareHub"))}
      for(let i=0;i<batch.length;i+=90)await env.DB.batch(batch.slice(i,i+90));
      const alerts=technicalAlerts(symbol,candles);
      for(const a of alerts){
        const exists=await env.DB.prepare("SELECT id FROM alert_events WHERE symbol=? AND alert_type=? AND created_at>=datetime('now','-1 day')").bind(symbol,a.type).first();
        if(!exists){await env.DB.prepare("INSERT INTO alert_events(symbol,alert_type,severity,message,metric_value) VALUES(?,?,?,?,?)").bind(symbol,a.type,a.severity,a.message,a.value).run();alertCount++}
      }
    }catch(e){console.error("History sync failed for",symbol,e.message)}
  }
  return {synced,alerts:alertCount};
}
async function api(request,env){
  const url=new URL(request.url),path=url.pathname;
  if(path==="/api/health")return json({ok:true,providerConfigured:!!(env.SHAREHUB_EMAIL&&env.SHAREHUB_PASSWORD),database:"D1"});
  if(path==="/api/holdings"&&request.method==="GET"){
    const r=await env.DB.prepare("SELECT h.symbol,h.quantity,h.wacc,q.ltp,q.change_percent,q.as_of FROM holdings h LEFT JOIN market_quotes q ON q.symbol=h.symbol ORDER BY h.symbol").all();return json({holdings:r.results});
  }
  if(path==="/api/holdings"&&request.method==="PUT"){
    const body=await request.json();if(!Array.isArray(body.holdings))return json({error:"holdings array required"},400);
    const stmts=body.holdings.map(h=>{const symbol=String(h.symbol||"").trim().toUpperCase();const quantity=Number(h.quantity),wacc=Number(h.wacc);if(!/^[A-Z0-9._-]{1,15}$/.test(symbol)||!Number.isFinite(quantity)||quantity<0||!Number.isFinite(wacc)||wacc<0)throw new Error("Invalid holding data");return env.DB.prepare("INSERT INTO holdings(symbol,quantity,wacc) VALUES(?,?,?) ON CONFLICT(symbol) DO UPDATE SET quantity=excluded.quantity,wacc=excluded.wacc,updated_at=CURRENT_TIMESTAMP").bind(symbol,quantity,wacc)});
    await env.DB.batch(stmts);return json({saved:stmts.length});
  }
  if(path==="/api/market"&&request.method==="GET"){
    const r=await env.DB.prepare("SELECT * FROM market_quotes ORDER BY symbol").all();return json({quotes:r.results});
  }
  if(path==="/api/alerts"&&request.method==="GET"){
    const r=await env.DB.prepare("SELECT * FROM alert_events ORDER BY created_at DESC LIMIT 100").all();return json({alerts:r.results});
  }
  if(path==="/api/refresh"&&request.method==="POST"){const result=await syncMarket(env);return json({ok:true,...result})}
  return json({error:"Not found"},404);
}
export default {
 async fetch(request,env){
  const headers=cors(request,env);
  if(request.method==="OPTIONS")return new Response(null,{status:204,headers});
  try{
   if(new URL(request.url).pathname.startsWith("/api/")) return withCors(await api(request,env),headers);
   if(env.ASSETS) return env.ASSETS.fetch(request);
   return withCors(json({error:"Static asset binding missing"},500),headers);
  }catch(e){console.error(e);return withCors(json({error:e.message||"Internal error"},e.message?.includes("not configured")?503:500),headers)}
 },
 async scheduled(controller,env,ctx){ctx.waitUntil(syncMarket(env).catch(e=>console.error("Scheduled NEPSE sync failed:",e.message)))}
};