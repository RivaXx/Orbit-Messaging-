// Location is requested only after consent. Coordinates remain in memory.
let orbitWeatherOwner=null,orbitWeatherEpoch=0,orbitWeatherTimer=null,orbitWeatherBusy=false,orbitWeatherLastFetch=0;
let orbitWeatherPermission=null,orbitWeatherAbort=null;
let orbitWeatherGeoCancel=null;
function orbitWeatherKey(){return `orbit_weather_enabled_${currentUser?.id||'guest'}`;}
function orbitWeatherEnabled(){try{return localStorage.getItem(orbitWeatherKey())==='true';}catch{return false;}}
function orbitWeatherLabel(text){document.getElementById('orbit-weather-label').textContent=text;}
function orbitWeatherCode(code,day){
    if(code===0)return {label:day?'Clear sky':'Clear night',kind:day?'sun':'moon',icon:day?'☀':'☾'};
    if(code<=3)return {label:code===3?'Overcast':'Partly cloudy',kind:'cloud',icon:'☁'};
    if(code===45||code===48)return {label:'Fog',kind:'cloud',icon:'≋'};
    if(code>=95)return {label:'Thunderstorm',kind:'storm',icon:'ϟ'};
    if([71,73,75,77,85,86].includes(code))return {label:'Snow',kind:'snow',icon:'❄'};
    if([51,53,55,56,57,61,63,65,66,67,80,81,82].includes(code))return {label:code<60?'Drizzle':'Rain',kind:'rain',icon:'☂'};
    return {label:'Current weather',kind:'cloud',icon:'☁'};
}
function openOrbitWeatherConsent(){
    document.getElementById('modal-orbit-weather').classList.add('active');
    document.getElementById('orbit-weather-disable').classList.toggle('hide',!orbitWeatherEnabled());
}
function closeOrbitWeatherConsent(){document.getElementById('modal-orbit-weather').classList.remove('active');}
function stopOrbitWeather(){
    orbitWeatherEpoch++;clearTimeout(orbitWeatherTimer);orbitWeatherTimer=null;
    orbitWeatherAbort?.abort();orbitWeatherAbort=null;orbitWeatherBusy=false;orbitWeatherLastFetch=0;orbitWeatherOwner=null;
    orbitWeatherGeoCancel?.();orbitWeatherGeoCancel=null;
    if(orbitWeatherPermission)orbitWeatherPermission.onchange=null;orbitWeatherPermission=null;
    document.getElementById('orbit-banner-weather').dataset.weather='idle';
    orbitWeatherLabel('Enable local weather');document.getElementById('orbit-weather-details').textContent='';document.getElementById('orbit-weather-icon').textContent='⌖';
}
function disableOrbitWeather(){try{localStorage.removeItem(orbitWeatherKey());}catch(_){}stopOrbitWeather();closeOrbitWeatherConsent();showToast('Local weather turned off.');}
async function enableOrbitWeather(){
    try{localStorage.setItem(orbitWeatherKey(),'true');}catch(_){}
    closeOrbitWeatherConsent();await refreshOrbitWeather(true);
    try{
        orbitWeatherPermission=await navigator.permissions.query({name:'geolocation'});
        orbitWeatherPermission.onchange=()=>{if(orbitWeatherPermission?.state!=='granted'){stopOrbitWeather();orbitWeatherLabel('Location off · Enable weather');}};
    }catch(_){}
}
async function initOrbitWeather(){
    const owner=currentUser?.id;if(!owner||orbitWeatherOwner===owner)return;
    stopOrbitWeather();orbitWeatherOwner=owner;
    if(!orbitWeatherEnabled())return;
    try{
        orbitWeatherPermission=await navigator.permissions.query({name:'geolocation'});
        orbitWeatherPermission.onchange=()=>{if(orbitWeatherPermission?.state!=='granted'){stopOrbitWeather();orbitWeatherLabel('Location off · Enable weather');}};
        if(orbitWeatherPermission.state==='granted')await refreshOrbitWeather(false);
        else orbitWeatherLabel('Allow location for weather');
    }catch(_){orbitWeatherLabel('Tap to enable local weather');}
}
function getOrbitPreciseWeatherLocation(){
    if(!navigator.geolocation)return Promise.reject(new Error('Location is not available on this device.'));
    return new Promise((resolve,reject)=>{
        let best=null,watch=null,done=false;
        const timeout=setTimeout(()=>finish(best?null:new Error('Could not get a location fix. Turn on device location and retry.')),18000);
        function finish(error){if(done)return;done=true;clearTimeout(timeout);if(watch!==null)navigator.geolocation.clearWatch(watch);orbitWeatherGeoCancel=null;if(error)reject(error);else resolve(best);}
        orbitWeatherGeoCancel=()=>finish(new Error('Location request cancelled.'));
        watch=navigator.geolocation.watchPosition(position=>{
            const coords=position.coords;
            if(!Number.isFinite(coords.latitude)||!Number.isFinite(coords.longitude)||!Number.isFinite(coords.accuracy)||coords.latitude<-90||coords.latitude>90||coords.longitude<-180||coords.longitude>180)return;
            if(!best||coords.accuracy<best.coords.accuracy)best=position;
            if(coords.accuracy<=80)finish(null);
        },error=>finish(new Error(error.code===1?'Location permission denied. Enable it in your browser settings to see weather.':'Location is unavailable. Turn on device location and retry.')),{enableHighAccuracy:true,maximumAge:0,timeout:15000});
    });
}
async function orbitWeatherFetch(url,signal){const response=await fetch(url,{signal,cache:'no-store',referrerPolicy:'no-referrer'});if(!response.ok)throw new Error('Weather service is temporarily unavailable.');return response.json();}
async function refreshOrbitWeather(explicit=false){
    if(orbitWeatherBusy||!orbitWeatherEnabled()||!currentUser)return;
    if(!explicit&&(document.hidden||Date.now()-orbitWeatherLastFetch<15*60000))return;
    const owner=currentUser.id,epoch=++orbitWeatherEpoch;orbitWeatherBusy=true;orbitWeatherOwner=owner;
    const pill=document.getElementById('orbit-banner-weather');pill.dataset.weather='loading';orbitWeatherLabel('Finding your location…');
    try{
        const position=await getOrbitPreciseWeatherLocation();
        if(epoch!==orbitWeatherEpoch||currentUser?.id!==owner||!orbitWeatherEnabled())return;
        const {latitude,longitude,accuracy}=position.coords;
        const controller=new AbortController();orbitWeatherAbort=controller;const timer=setTimeout(()=>controller.abort(),15000);
        let weather,place;
        try{
            const results=await Promise.allSettled([
                orbitWeatherFetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code,is_day,apparent_temperature&timeformat=unixtime&timezone=auto&forecast_days=1`,controller.signal),
                orbitWeatherFetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`,controller.signal)
            ]);
            if(results[0].status!=='fulfilled')throw results[0].reason;
            weather=results[0].value;place=results[1].status==='fulfilled'?results[1].value:null;
        }finally{clearTimeout(timer);}
        if(epoch!==orbitWeatherEpoch||currentUser?.id!==owner||!orbitWeatherEnabled())return;
        const current=weather.current;
        if(!Number.isFinite(current?.temperature_2m)||!Number.isFinite(current?.weather_code)||!Number.isFinite(current?.time))throw new Error('Weather data is unavailable. Try again.');
        const condition=orbitWeatherCode(current.weather_code,current.is_day===1);
        const location=place?.locality||place?.city||place?.principalSubdivision||'Your location';
        pill.dataset.weather=condition.kind;document.getElementById('orbit-weather-icon').textContent=condition.icon;
        orbitWeatherLabel(`${Math.round(current.temperature_2m)}° · ${condition.label}`);
        const metres=Math.round(accuracy),range=metres<1000?`${metres} m`:`${(metres/1000).toFixed(1)} km`;
        document.getElementById('orbit-weather-details').textContent=`${location} · ${metres>500?'Approx. ':''}±${range}`;
        document.getElementById('orbit-weather-updated').textContent=`Weather updated ${new Date(current.time*1000).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}. Location accuracy ±${range}. Weather is an estimate for the nearby forecast grid.`;
        pill.title=`${location} · ${condition.label} · Location accuracy ±${range}`;
        orbitWeatherLastFetch=Date.now();
        clearTimeout(orbitWeatherTimer);orbitWeatherTimer=setTimeout(()=>refreshOrbitWeather(false),15*60000);
    }catch(error){if(epoch===orbitWeatherEpoch){pill.dataset.weather='idle';orbitWeatherLabel('Weather unavailable · Retry');document.getElementById('orbit-weather-details').textContent=error.message||'Please try again.';}}
    finally{if(epoch===orbitWeatherEpoch){orbitWeatherBusy=false;orbitWeatherAbort=null;}}
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshOrbitWeather(false);});
window.addEventListener('online',()=>refreshOrbitWeather(false));
