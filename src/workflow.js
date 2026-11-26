export const USERS = [
 {id:'req',name:'Production User',department:'Production',role:'requester'},
 {id:'approver',name:'Production Manager',department:'Production',role:'approver'},
 {id:'rnd',name:'R&D Technician',department:'R&D',role:'rnd'},
 {id:'head',name:'R&D Head',department:'R&D',role:'head'},
];
export const ROLES={requester:'Production Requester',approver:'Department Approver',rnd:'R&D Receiver',head:'R&D Head'};
export const STATUS={draft:'Draft',new:'New request',correction:'Returned for correction',received:'Received',planned:'Planned',progress:'In progress',temporary:'Use temporarily',monitoring:'Under monitoring',verification:'Pending verification',ack:'Pending acknowledgement',closed:'Closed',rejected:'Rejected',unable:'Unable to proceed'};
export const FINAL=['closed','rejected','unable'];
export const RND = u=>['rnd','head'].includes(u.role);
export const canSee=(o,u)=>o.requesterId===u.id || (o.status!=='draft' && (RND(u)?!!o.approvedAt || o.status==='closed' || o.history.some(h=>h.action==='Approved'):u.role==='approver'&&o.department===u.department));
export const canEditA=(o,u)=>o.requesterId===u.id&&!FINAL.includes(o.status);
export const canEditB=(o,u)=>RND(u)&&!!o.approvedAt&&['received','planned','progress','temporary','monitoring'].includes(o.status);
export const canApprove=(o,u)=>u.role==='approver'&&o.department===u.department&&o.requesterId!==u.id&&o.status==='new'&&!o.approvedAt;
export const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
export const overdue=o=>!FINAL.includes(o.status)&&o.status!=='draft'&&!!o.due&&o.due<today();
export const stamp=()=>new Date().toISOString();
export const fmt=v=>v?new Date(v.length===10?v+'T00:00:00':v).toLocaleString('en-MY',v.length===10?{day:'numeric',month:'short',year:'numeric'}:{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
export const id=()=>globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
export const TYPES=['Mechanical','Electrical','Building','Others'];
export const REASONS=['Repair / Damaged','New / Improvement','Safety','Replacement','Others'];
export const TEAMS=['R&D','Maintenance / Kaizen','Mould maker','Production','Others'];
export const PICS=['R&D Technician','R&D Engineer','R&D Head'];
export function emptyOrder(user,workOrderId){return {id:id(),workOrderId,ref:'',status:'draft',requesterId:user.id,issuedBy:user.name,department:user.department,section:'',title:'',description:'',team:'R&D',teamOther:'',types:[],typeOther:'',reasons:[],reasonOther:'',sketch:'No',due:'',priority:'Normal',photos:[],documents:[],history:[],createdAt:stamp(),submittedAt:'',approvedAt:'',approvedBy:'',receivedAt:'',receivedBy:'',method:'',external:'',evaluation:'',pic:'',start:'',estimate:'',actual:'',outcome:'',completionRemarks:'',verificationRequired:false,completedBy:'',completedAt:'',verifiedBy:'',verifiedAt:'',ackBy:'',ackAt:''};}
export function validateA(o){if(!o.title.trim()||!o.section.trim()||!o.description.trim()||!o.due||!o.team||!o.types.length||!o.reasons.length)return 'Complete the title, section, description, work type, reason and requested completion date.';if((['Production','Others'].includes(o.team)&&!o.teamOther.trim())||(o.types.includes('Others')&&!o.typeOther.trim())||(o.reasons.includes('Others')&&!o.reasonOther.trim()))return 'Please specify the selected Other / Production details.';if(!o.photos.some(validBeforePhoto))return 'Please upload at least one photo of the original condition or work requirement.';return '';}
export function log(o,u,action,details='',changes=[]){const at=stamp();return {...o,updatedAt:at,history:[...o.history,{id:id(),at,by:u.name,byId:u.id,role:u.role,action,details,changes}]};}
export function actions(o,u){let a=[];if(canEditA(o,u)&&['draft','correction'].includes(o.status))a.push('submit');if(canApprove(o,u))a.push('approve','return','reject');if(RND(u)&&o.approvedAt&&o.status==='new')a.push('receive','return');if(canEditB(o,u)){if(o.status==='received')a.push('plan','unable');if(o.status==='planned')a.push('start','unable');if(['progress','temporary','monitoring'].includes(o.status))a.push('finish','unable');}if(o.status==='verification'&&u.role==='head')a.push('verify','rectify');if(o.status==='ack'&&o.requesterId===u.id)a.push('close','rectify');if(o.status==='closed'&&u.role==='head')a.push('reopen');return a;}
export function transition(o,u,action,note=''){
 if(!actions(o,u).includes(action))throw Error('This action is not permitted for the current role or status.');
 let p={};let label='';const at=stamp();const requireNote=()=>{if(!note.trim())throw Error('Please provide a reason.');};
 switch(action){
 case 'submit':{const error=validateA(o);if(error)throw Error(error);p={status:'new',submittedAt:o.submittedAt||at,approvedAt:'',approvedBy:'',receivedAt:'',receivedBy:''};label='Request submitted';break;}
 case 'approve':p={approvedAt:at,approvedBy:u.name};label='Approved';break;
 case 'return':requireNote();p={status:'correction',approvedAt:'',approvedBy:''};label='Returned for correction';break;
 case 'reject':requireNote();p={status:'rejected'};label='Rejected';break;
 case 'receive':p={status:'received',receivedAt:at,receivedBy:u.name};label='Received by R&D';break;
 case 'plan':if(!o.method||o.method==='Unable to proceed'||!o.pic||!o.start||!o.estimate)throw Error('Set a valid work method, PIC, start and estimated completion first.');if(o.method==='External party'&&!o.external.trim())throw Error('Specify the external party.');if(o.estimate<o.start)throw Error('Estimated completion cannot precede start.');p={status:'planned'};label='Work planned';break;
 case 'start':p={status:'progress',startedAt:at};label='Work started';break;
 case 'unable':requireNote();p={status:'unable',method:'Unable to proceed',evaluation:note};label='Unable to proceed';break;
 case 'finish':if(!o.outcome||!o.actual||!o.completionRemarks.trim())throw Error('Enter completion outcome, actual date/time and justification.');if(o.startedAt&&Math.floor(new Date(o.actual).getTime()/60000)<Math.floor(new Date(o.startedAt).getTime()/60000))throw Error('Actual completion cannot precede actual start.');if(new Date(o.actual)>new Date())throw Error('Actual completion cannot be in the future.');p={status:o.outcome==='Completed'?(o.verificationRequired?'verification':'ack'):o.outcome==='Use temporarily'?'temporary':'monitoring',completedBy:u.name,completedAt:at,verifiedBy:'',verifiedAt:'',ackBy:'',ackAt:''};label=o.outcome==='Completed'?'Work completed':o.outcome;break;
 case 'verify':p={status:'ack',verifiedBy:u.name,verifiedAt:at};label='Accuracy verified';break;
 case 'rectify':requireNote();p={status:'progress',actual:'',outcome:'',completedBy:'',completedAt:'',verifiedBy:'',verifiedAt:'',ackBy:'',ackAt:''};label='Returned for rectification';break;
 case 'reopen':requireNote();p={status:'progress',actual:'',outcome:'',completedBy:'',completedAt:'',verifiedBy:'',verifiedAt:'',ackBy:'',ackAt:''};label='Work order reopened';break;
 case 'close':p={status:'closed',ackBy:u.name,ackAt:at};label='Acknowledged and closed';break;
 }
 return log({...o,...p},u,label,note,diff(o,p));
}
export const validBeforePhoto=p=>p?.kind==='before'&&p.blob instanceof Blob&&p.blob.size>0&&p.blob.size<=8*1024*1024&&['image/jpeg','image/png','image/webp'].includes(p.blob.type);
export function nextWorkOrderId(orders,year=new Date().getFullYear()){
 const prefix=`WO-${year}-`;const seq=1+Math.max(0,...orders.map(o=>o.workOrderId||'').filter(v=>v.startsWith(prefix)).map(v=>Number(v.slice(prefix.length))||0));return prefix+String(seq).padStart(4,'0');
}
export function migrateOrders(orders){const used=new Set();return orders.map((o,i)=>{let wo=o.workOrderId||(/^WO-\d{4}-\d+$/.test(o.ref||'')?o.ref:'');if(!wo||used.has(wo))wo=nextWorkOrderId([...orders,...[...used].map(workOrderId=>({workOrderId})),...orders.map(x=>({workOrderId:x.ref}))]);used.add(wo);return {...o,workOrderId:wo,ref:o.workOrderId?o.ref||'':o.ref===wo?'':o.ref||'',photos:o.photos||[],documents:o.documents||[],history:o.history||[]};});}
const A_KEYS=['ref','section','title','description','team','teamOther','types','typeOther','reasons','reasonOther','sketch','due','priority','photos','documents'];
const MATERIAL=['section','title','description','team','teamOther','types','typeOther','reasons','reasonOther','sketch','due','priority','photos','documents'];
const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function diff(original,patch){return Object.keys(patch).filter(k=>!eq(original[k],patch[k])).map(k=>({field:k,previous:original[k]??null,updated:patch[k]??null}));}
function proposedA(o,d){const p={};for(const k of A_KEYS)p[k]=d[k]??o[k];const before=d.photos.filter(x=>x.kind==='before');p.photos=eq(before,o.photos.filter(x=>x.kind==='before'))?o.photos:[...before,...o.photos.filter(x=>x.kind!=='before')];return p;}
export function materialChanges(o,d,u){return canEditA(o,u)&&!['draft','correction'].includes(o.status)&&diff(o,proposedA(o,d)).some(c=>MATERIAL.includes(c.field));}
export function saveEdits(original,draft,u,note=''){
 const a=canEditA(original,u),b=canEditB(original,u);if(!a&&!b)throw Error('No changes are available for this account at this stage.');
 // A user holding both roles edits their own request and R&D fields only where independently authorised.
 let p=a?proposedA(original,draft):{};
 if(b){for(const k of ['method','external','evaluation','start','estimate','actual','outcome','completionRemarks','verificationRequired',...(u.role==='head'?['pic']:[])])p[k]=draft[k]??original[k];if(original.status!=='received'&&(!p.method||p.method==='Unable to proceed'||!p.start||!p.estimate||(p.pic??original.pic)===''))throw Error('Keep the approved work plan complete.');if(p.start&&p.estimate&&p.estimate<p.start)throw Error('Estimated completion cannot precede start.');if(p.method==='External party'&&!p.external.trim())throw Error('Specify the external party.');p.photos=[...(a?p.photos:original.photos).filter(x=>x.kind==='before'),...draft.photos.filter(x=>x.kind!=='before')];}
 const changes=diff(original,p);if(!changes.length)return original;
 const submitted=a&&!['draft','correction'].includes(original.status);
 const material=submitted&&changes.some(c=>MATERIAL.includes(c.field)&&(!b||c.field!=='photos'||!eq(original.photos.filter(x=>x.kind==='before'),p.photos.filter(x=>x.kind==='before'))));
 if(material){if(!note.trim())throw Error('Please explain the reason for this request change.');const error=validateA({...original,...p});if(error)throw Error(error);}
 if(submitted&&changes.some(c=>c.field==='photos')&&!p.photos.some(validBeforePhoto)&&!b)throw Error('Keep at least one valid before-work photo.');
 if(b&&changes.some(c=>['estimate','start','method','pic','photos'].includes(c.field))&&original.status!=='received'&&!note.trim())throw Error('Please enter a reason for the planning or photo change.');
 // Material requester changes require fresh approval; retain old values and evidence in history.
 if(material&&original.approvedAt){Object.assign(p,{status:'new',approvedAt:'',approvedBy:'',receivedAt:'',receivedBy:'',method:'',external:'',evaluation:'',pic:'',start:'',estimate:'',startedAt:'',actual:'',outcome:'',completionRemarks:'',verificationRequired:false,completedBy:'',completedAt:'',verifiedBy:'',verifiedAt:'',ackBy:'',ackAt:'',photos:p.photos.filter(x=>x.kind==='before')});}
 return log({...original,...p},u,material&&original.approvedAt?'Request updated — reapproval required':'Details updated',note,diff(original,p));
}
