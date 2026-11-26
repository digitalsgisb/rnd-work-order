// IndexedDB stores structured data and image/PDF Blobs locally, not in localStorage.
const DB='sugihara-workflow-v1';
function open(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore('state');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
export async function load(){const db=await open();try{return await new Promise((res,rej)=>{const r=db.transaction('state').objectStore('state').get('orders');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}finally{db.close();}}
export async function persist(orders){const db=await open();try{await new Promise((res,rej)=>{const tx=db.transaction('state','readwrite');tx.objectStore('state').put(orders,'orders');tx.oncomplete=res;tx.onerror=()=>rej(tx.error);tx.onabort=()=>rej(tx.error||Error('Storage transaction aborted'));});}finally{db.close();}}
