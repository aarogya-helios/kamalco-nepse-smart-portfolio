
const COOKIE="kamalco_session",SESSION_SECONDS=43200,enc=new TextEncoder();
const b64u=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");
const unb64u=s=>Uint8Array.from(atob(s.replace(/-/g,"+").replace(/_/g,"/")+"===".slice((s.length+3)%4)),c=>c.charCodeAt(0));
async function hkey(secret){return crypto.subtle.importKey("raw",enc.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign","verify"])}
async function sessionToken(env){const p=b64u(enc.encode(JSON.stringify({sub:"owner",exp:Math.floor(Date.now()/1000)+SESSION_SECONDS})));const sig=b64u(await crypto.subtle.sign("HMAC",await hkey(env.SESSION_SECRET),enc.encode(p)));return p+"."+sig}
async function validSession(req,env){const c=req.headers.get("Cookie")||"",t=c.split(";").map(x=>x.trim()).find(x=>x.startsWith(COOKIE+"="))?.slice(COOKIE.length+1);if(!t||!env.SESSION_SECRET)return false;try{const [p,s,...rest]=t.split(".");if(!p||!s||rest.length)return false;if(!await crypto.subtle.verify("HMAC",await hkey(env.SESSION_SECRET),unb64u(s),enc.encode(p)))return false;const d=JSON.parse(new TextDecoder().decode(unb64u(p)));return d.sub==="owner"&&d.exp>Math.floor(Date.now()/1000)}catch{return false}}
function cookie(v,age=SESSION_SECONDS){return COOKIE+"="+v+"; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age="+age}
async function authApi(req,env){const path=new URL(req.url).pathname,origin=new URL(req.url).origin;
 if(path==="/api/login"&&req.method==="POST"){if(req.headers.get("Origin")!==origin)return json({error:"Invalid request origin."},403);if(!env.APP_PASSWORD||!env.SESSION_SECRET)return json({error:"Login secrets are not configured."},503);let b;try{b=await req.json()}catch{return json({error:"Invalid request."},400)}const supplied=String(b.password||""),[a,z]=await Promise.all([crypto.subtle.digest("SHA-256",enc.encode(supplied)),crypto.subtle.digest("SHA-256",enc.encode(env.APP_PASSWORD))]);let diff=0;const aa=new Uint8Array(a),zz=new Uint8Array(z);for(let i=0;i<aa.length;i++)diff|=aa[i]^zz[i];if(diff!==0)return json({error:"Incorrect password."},401);return new Response(JSON.stringify({ok:true}),{headers:{"content-type":"application/json","cache-control":"no-store","set-cookie":cookie(await sessionToken(env))}})}
 if(path==="/api/session"&&req.method==="GET")return json({authenticated:await validSession(req,env)});
 if(path==="/api/logout"&&req.method==="POST"){if(req.headers.get("Origin")!==origin)return json({error:"Invalid request origin."},403);return new Response(JSON.stringify({ok:true}),{headers:{"content-type":"application/json","cache-control":"no-store","set-cookie":cookie("",0)}})}
 if(!await validSession(req,env))return json({error:"Please log in to access your portfolio."},401);
 return api(req,env);
}
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
async function publicMarketQuotes(){
  const url="https://raw.githubusercontent.com/Shubhamnpk/yonepse/main/data/nepse_data.json";
  const response=await fetch(url,{headers:{"accept":"application/json"}});
  if(!response.ok)throw new Error("Public NEPSE mirror returned HTTP "+response.status);
  const rows=await response.json();
  if(!Array.isArray(rows))throw new Error("Public NEPSE mirror returned an unexpected data format.");
  const valid=rows.filter(q=>q&&typeof q.symbol==="string"&&Number.isFinite(Number(q.ltp))&&Number(q.ltp)>0);
  if(!valid.length)throw new Error("Public NEPSE mirror has no valid stock prices.");
  const dates=valid.map(q=>Date.parse(q.last_updated||"")).filter(Number.isFinite);
  if(!dates.length)throw new Error("Public NEPSE mirror has no usable price timestamps.");
  const newest=Math.max(...dates),ageHours=(Date.now()-newest)/3600000;
  if(ageHours>24)throw new Error("Public NEPSE mirror data is too old ("+Math.floor(ageHours)+" hours). No stale prices were saved.");
  return valid;
}
async function syncMarket(env){
  const held=await env.DB.prepare("SELECT symbol FROM holdings").all();const symbols=held.results.map(x=>x.symbol);
  if(!symbols.length)return {synced:0,alerts:0};
  let quotes,source="ShareHub";
  try{quotes=await providerGet(env,"/stock-prices");}
  catch(shareHubError){
    console.warn("ShareHub unavailable; trying public NEPSE mirror:",shareHubError.message);
    quotes=await publicMarketQuotes();
    source="YONEPSE public mirror";
  }
  const now=new Date().toISOString();
  const quoteMap=new Map((Array.isArray(quotes)?quotes:[]).map(q=>[String(q.symbol||"").trim().toUpperCase(),q]));
  let synced=0,alertCount=0;
  const npNow=new Date(Date.now()+345*60*1000);
  const npDate=npNow.toISOString().slice(0,10);
  const historyMarker=await env.DB.prepare("SELECT value FROM app_settings WHERE key='history_sync_date'").first();
  const historyDue=(npNow.getUTCHours()*60+npNow.getUTCMinutes()>=915) && historyMarker?.value!==npDate;
  for(const symbol of symbols){
    const q=quoteMap.get(String(symbol).trim().toUpperCase());if(q&&Number.isFinite(Number(q.ltp))&&Number(q.ltp)>0){
      await env.DB.prepare("INSERT OR REPLACE INTO market_quotes(symbol,ltp,change_percent,as_of,source) VALUES(?,?,?,?,?)").bind(symbol,Number(q.ltp),Number(q.changePercent??q.percent_change??0),q.lastUpdatedTime||q.last_updated||now,source).run();synced++;
    }
    if(historyDue) try{
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
  if(historyDue) await env.DB.prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('history_sync_date',?)").bind(npDate).run();
  return {synced,alerts:alertCount,source};
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
    if(stmts.length){const symbols=body.holdings.map(h=>String(h.symbol||"").trim().toUpperCase());const marks=symbols.map(()=>"?").join(",");await env.DB.batch([...stmts,env.DB.prepare("DELETE FROM holdings WHERE symbol NOT IN ("+marks+")").bind(...symbols)]);}else{await env.DB.prepare("DELETE FROM holdings").run()}return json({saved:stmts.length});
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
   if(new URL(request.url).pathname.startsWith("/api/")) return withCors(await authApi(request,env),headers);
   if(env.ASSETS) return env.ASSETS.fetch(request);
   return withCors(json({error:"Static asset binding missing"},500),headers);
  }catch(e){console.error(e);return withCors(json({error:e.message||"Internal error"},e.message?.includes("not configured")?503:500),headers)}
 },
 async scheduled(controller,env,ctx){
  // Cloudflare cron is UTC. Run automatic quotes only on Nepal trading days
  // during the NEPSE session, with one final pass at 15:15 for daily history.
  const npNow=new Date(Date.now()+345*60*1000);
  const day=npNow.getUTCDay(),minute=npNow.getUTCHours()*60+npNow.getUTCMinutes();
  if(day===0||day===6||minute<660||minute>915)return;
  ctx.waitUntil(syncMarket(env).catch(e=>console.error("Scheduled NEPSE sync failed:",e.message)));
 }
};