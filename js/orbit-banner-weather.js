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
    let motion='calm';try{motion=localStorage.getItem('orbit_weather_motion')||'calm';}catch(_){}
    setOrbitWeatherMotion(motion,false);
    document.getElementById('modal-orbit-weather').classList.add('active');
    document.getElementById('orbit-weather-disable').classList.toggle('hide',!orbitWeatherEnabled());
    document.getElementById('orbit-weather-refresh').textContent=orbitWeatherEnabled()?'Refresh weather':'Allow location & show weather';
}
function setOrbitWeatherMotion(value,save=true){
    if(!['calm','live','still'].includes(value))value='calm';
    document.getElementById('modal-orbit-weather').dataset.motion=value;
    const select=document.getElementById('orbit-weather-motion');if(select)select.value=value;
    if(save)try{localStorage.setItem('orbit_weather_motion',value);}catch(_){}
}
function orbitAqiCategory(value){
    if(!Number.isFinite(value)||value<0)return 'Unavailable';
    return value<=50?'Good':value<=100?'Moderate':value<=150?'Unhealthy for sensitive groups':value<=200?'Unhealthy':value<=300?'Very unhealthy':'Hazardous';
}
function renderOrbitWeatherMetrics(weather,air){
    const current=weather.current||{},daily=weather.daily||{},quality=air?.current||{};
    const number=(value,unit='',digits=0)=>Number.isFinite(value)?`${value.toFixed(digits)}${unit}`:'Unavailable';
    const time=value=>Number.isFinite(value)?new Date(value*1000).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',timeZone:weather.timezone||undefined}):'Unavailable';
    const values={humidity:number(current.relative_humidity_2m,'%'),feels:number(current.apparent_temperature,'°C'),
        wind:number(current.wind_speed_10m,' km/h'),rain:number(current.precipitation,' mm',1),pressure:number(current.surface_pressure,' hPa'),
        aqi:Number.isFinite(quality.us_aqi)?`${Math.round(quality.us_aqi)} · ${orbitAqiCategory(quality.us_aqi)}`:'Unavailable',
        pm25:number(quality.pm2_5,' µg/m³',1),pm10:number(quality.pm10,' µg/m³',1),
        highlow:`${number(daily.temperature_2m_max?.[0],'°')} / ${number(daily.temperature_2m_min?.[0],'°')}`,
        chance:number(daily.precipitation_probability_max?.[0],'%'),uv:number(daily.uv_index_max?.[0],'',1),
        sun:`${time(daily.sunrise?.[0])} / ${time(daily.sunset?.[0])}`};
    Object.entries(values).forEach(([key,value])=>{const el=document.getElementById(`orbit-weather-${key}`);if(el)el.textContent=value;});
    document.getElementById('orbit-weather-metrics').classList.remove('hide');
    document.getElementById('orbit-weather-air-status').textContent=Number.isFinite(quality.us_aqi)
        ?`Air quality model updated ${time(quality.time)}. AQI uses the US scale; model estimates can differ from local monitors.`
        :'Air quality is temporarily unavailable. Other weather details are still shown.';
}
function closeOrbitWeatherConsent(){document.getElementById('modal-orbit-weather').classList.remove('active');}
function stopOrbitWeather(){
    orbitWeatherEpoch++;clearTimeout(orbitWeatherTimer);orbitWeatherTimer=null;
    orbitWeatherAbort?.abort();orbitWeatherAbort=null;orbitWeatherBusy=false;orbitWeatherLastFetch=0;orbitWeatherOwner=null;
    orbitWeatherGeoCancel?.();orbitWeatherGeoCancel=null;
    if(orbitWeatherPermission)orbitWeatherPermission.onchange=null;orbitWeatherPermission=null;
    document.getElementById('orbit-banner-weather').dataset.weather='idle';
    orbitWeatherLabel('Enable local weather');document.getElementById('orbit-weather-details').textContent='';document.getElementById('orbit-weather-icon').textContent='⌖';
    document.getElementById('orbit-weather-metrics')?.classList.add('hide');
    document.getElementById('orbit-weather-air-status').textContent='';
    document.getElementById('orbit-weather-updated').textContent='';
    const page=document.getElementById('modal-orbit-weather');if(page){page.dataset.weather='idle';page.dataset.night='false';}
    const temperature=document.getElementById('orbit-weather-temperature');if(temperature)temperature.textContent='—°';
    const place=document.getElementById('orbit-weather-place');if(place)place.textContent='Your local forecast';
    const condition=document.getElementById('orbit-weather-condition');if(condition)condition.textContent='Enable location to see current conditions';
}
function disableOrbitWeather(){try{localStorage.removeItem(orbitWeatherKey());}catch(_){}stopOrbitWeather();closeOrbitWeatherConsent();showToast('Local weather turned off.');}
async function enableOrbitWeather(){
    try{localStorage.setItem(orbitWeatherKey(),'true');}catch(_){}
    await refreshOrbitWeather(true);
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
            if(!Number.isFinite(coords.latitude)||!Number.isFinite(coords.longitude)||!Number.isFinite(coords.accuracy)||coords.accuracy<0||coords.latitude<-90||coords.latitude>90||coords.longitude<-180||coords.longitude>180)return;
            if(Number.isFinite(position.timestamp)&&Date.now()-position.timestamp>30000)return;
            if(!best||coords.accuracy<best.coords.accuracy)best=position;
            if(coords.accuracy<=30)finish(null);
        },error=>finish(best&&error.code!==1?null:new Error(error.code===1?'Location permission denied. Enable it in your browser settings to see weather.':'Location is unavailable. Turn on device location and retry.')),{enableHighAccuracy:true,maximumAge:0,timeout:15000});
        if(done&&watch!==null)navigator.geolocation.clearWatch(watch);
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
        let weather,place,air;
        try{
            const results=await Promise.allSettled([
                orbitWeatherFetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code,is_day,apparent_temperature,relative_humidity_2m,wind_speed_10m,precipitation,surface_pressure&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max,sunrise,sunset&temperature_unit=celsius&wind_speed_unit=kmh&precipitation_unit=mm&timeformat=unixtime&timezone=auto&forecast_days=1`,controller.signal),
                orbitWeatherFetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`,controller.signal),
                orbitWeatherFetch(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${latitude}&longitude=${longitude}&current=us_aqi,pm2_5,pm10&timeformat=unixtime&timezone=auto&forecast_days=1`,controller.signal)
            ]);
            if(results[0].status!=='fulfilled')throw results[0].reason;
            weather=results[0].value;place=results[1].status==='fulfilled'?results[1].value:null;
            air=results[2].status==='fulfilled'?results[2].value:null;
        }finally{clearTimeout(timer);}
        if(epoch!==orbitWeatherEpoch||currentUser?.id!==owner||!orbitWeatherEnabled())return;
        const current=weather.current;
        if(!Number.isFinite(current?.temperature_2m)||!Number.isFinite(current?.weather_code)||!Number.isFinite(current?.time))throw new Error('Weather data is unavailable. Try again.');
        const condition=orbitWeatherCode(current.weather_code,current.is_day===1);
        const location=place?.locality||place?.city||place?.principalSubdivision||'Your location';
        const page=document.getElementById('modal-orbit-weather');page.dataset.weather=condition.kind;page.dataset.night=String(current.is_day!==1);
        document.getElementById('orbit-weather-place').textContent=location;
        document.getElementById('orbit-weather-temperature').textContent=`${Math.round(current.temperature_2m)}°`;
        document.getElementById('orbit-weather-condition').textContent=condition.label;
        pill.dataset.weather=condition.kind;document.getElementById('orbit-weather-icon').textContent=condition.icon;
        orbitWeatherLabel(`${Math.round(current.temperature_2m)}° · ${condition.label}`);
        const metres=Math.round(accuracy),range=metres<1000?`${metres} m`:`${(metres/1000).toFixed(1)} km`;
        const humidity=Number.isFinite(current.relative_humidity_2m)?` · Humidity ${Math.round(current.relative_humidity_2m)}%`:'';
        const aqi=Number.isFinite(air?.current?.us_aqi)?` · AQI (US) ${Math.round(air.current.us_aqi)}`:'';
        document.getElementById('orbit-weather-details').textContent=`${location}${humidity}${aqi}`;
        renderOrbitWeatherMetrics(weather,air);
        document.getElementById('orbit-weather-updated').textContent=`Weather updated ${new Date(current.time*1000).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',timeZone:weather.timezone||undefined})}. Location accuracy ±${range}.${accuracy>1000?' Approximate location: turn on precise location in your device settings for a closer forecast.':''} Weather is an estimate for the nearby forecast grid.`;
        pill.title=`${location} · ${condition.label} · Location accuracy ±${range}`;
        orbitWeatherLastFetch=Date.now();
        clearTimeout(orbitWeatherTimer);orbitWeatherTimer=setTimeout(()=>refreshOrbitWeather(false),15*60000);
    }catch(error){if(epoch===orbitWeatherEpoch){pill.dataset.weather='idle';orbitWeatherLabel('Weather unavailable · Retry');document.getElementById('orbit-weather-details').textContent=error.message||'Please try again.';}}
    finally{if(epoch===orbitWeatherEpoch){orbitWeatherBusy=false;orbitWeatherAbort=null;}}
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshOrbitWeather(false);});
window.addEventListener('online',()=>refreshOrbitWeather(false));
