const PREFIX='aoms:v2:';
export class ReadCache {
  get(key){ try { return JSON.parse(localStorage.getItem(PREFIX+key)||'null'); } catch { return null; } }
  set(key,value){ try { localStorage.setItem(PREFIX+key,JSON.stringify({value,at:new Date().toISOString()})); return true; } catch { return false; } }
  clear(){ Object.keys(localStorage).filter(k=>k.startsWith(PREFIX)).forEach(k=>localStorage.removeItem(k)); }
}
