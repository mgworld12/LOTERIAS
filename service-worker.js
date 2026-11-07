const CACHE='loterias-caixa-v3.0.0';
const ASSETS=['./','./index.html','./style.css','./script.js','./conferir.js','./vendor/jsQR.js','./manifest.json','./icons/icon.svg','./icons/icon-192.png','./icons/icon-512.png','./icons/icon-maskable-512.png','./icons/apple-touch-icon.png','./data/index.json'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).catch(()=>{}).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET')return;
 const url=new URL(event.request.url);
 if(url.origin!==self.location.origin)return;
 event.respondWith((async()=>{
  const cache=await caches.open(CACHE);
  try{
   const response=await fetch(event.request,{cache:'no-store'});
   if(response.ok)cache.put(event.request,response.clone());
   return response;
  }catch(error){
   const cached=await cache.match(event.request);
   if(cached)return cached;
   if(event.request.mode==='navigate')return (await cache.match('./index.html'))||Response.error();
   return Response.error();
  }
 })());
});
