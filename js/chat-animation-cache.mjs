export class MediaCache {
    constructor(limit) { this.limit=limit; this.bytes=0; this.entries=new Map(); }
    get(key) {
        const entry=this.entries.get(key);
        if(entry){this.entries.delete(key);this.entries.set(key,entry);}
        return entry;
    }
    set(key,entry) {
        const prior=this.entries.get(key);
        if(prior){this.bytes-=prior.bytes;this.entries.delete(key);}
        if(entry.bytes>this.limit)return;
        while(this.bytes+entry.bytes>this.limit){
            const oldest=this.entries.keys().next().value;
            this.bytes-=this.entries.get(oldest).bytes;this.entries.delete(oldest);
        }
        this.entries.set(key,entry);this.bytes+=entry.bytes;
    }
    clear(){this.entries.clear();this.bytes=0;}
}
