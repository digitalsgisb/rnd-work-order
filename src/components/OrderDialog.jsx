import {getPlanningPics} from '../api.js';
import {validateA} from '../workflow.js';
import React,{useState,useEffect} from 'react';
import {ClipboardList,ShieldCheck,CalendarDays,Image,CheckCircle2,History,Pencil,User,FileText} from 'lucide-react';
import Modal from './Modal.jsx';
import {Input,Select,Textarea,Checks,Section,Info} from './Fields.jsx';
import Photos,{Documents,AuditFiles} from './Photos.jsx';
import {STATUS,canEditA,canEditB,actions,saveEdits,transition,fmt,TYPES,REASONS,TEAMS,PICS,RND,overdue,validBeforePhoto,materialChanges,ROLES} from '../workflow.js';
const labels={submit:'Submit request',approve:'Approve',return:'Return for correction',reject:'Reject',receive:'Acknowledge receipt',plan:'Confirm work plan',start:'Start work',unable:'Unable to proceed',finish:'Record completion',verify:'Verify accuracy',rectify:'Return for rectification',close:'Acknowledge & close',reopen:'Reopen work order'};
export function Status({order}){return <span className={'status status-'+(order.status==='new'&&!order.approvedAt?'approval':order.status)}>{order.status==='new'&&!order.approvedAt?'Pending approval':STATUS[order.status]}</span>}

export default function OrderDialog({order,user,onSave,onClose,isNew=false,readOnly=false}){const [base,setBase]=useState(order);
    const [reloadRequired,setReloadRequired]=useState(false);
    const [pics,setPics]=useState([]);
    const [picError,setPicError]=useState('');

    useEffect(()=>{
      if(!['rnd','head'].includes(user.role) ||
         base.status!=='received') return;

      let active=true;

      getPlanningPics()
        .then(data=>{
          if(active) setPics(data);
        })
        .catch(e=>{
          if(active) setPicError(e.message);
        });

      return ()=>{active=false;};
    },[user.role,base.status]);const [draft,setDraft]=useState(order);const [dirty,setDirty]=useState(isNew);const [editing,setEditing]=useState(!readOnly&&(isNew||order.status==='draft'||order.status==='correction'));const [editReason,setEditReason]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [reason,setReason]=useState('');const [confirmAction,setConfirmAction]=useState('');const allowA=!readOnly&&!reloadRequired&&canEditA(base,user),
    allowB=
      !readOnly &&
      !reloadRequired &&
      ['rnd','head'].includes(user.role) &&
      !!base.approvedAt &&
      ['received','progress','temporary','monitoring']
        .includes(base.status);

    const a=allowA&&editing,b=allowB&&editing;

    const planning=b&&base.status==='received';

    const completion=b&&
      ['progress','temporary','monitoring']
        .includes(base.status);const significant=a&&materialChanges(base,draft,user);const photoOK=draft.photos.some(validBeforePhoto);const change=(key,value)=>{setDraft(d=>({...d,[key]:value}));setDirty(true);setError('');};const bind=key=>({value:draft[key],onChange:v=>change(key,v)});const acts=(
      readOnly||reloadRequired
        ? []
        : actions(base,user).filter(
          x=>['submit','approve','return','reject',
            'receive','plan','start','finish',
            'verify','rectify','close','reopen','unable'].includes(x)
        )
    ).filter(x=>!editing||['draft','correction'].includes(base.status)||x==='submit');const close=()=>{if(!busy&&(!dirty||window.confirm('Discard unsaved changes?')))onClose();};
async function commit(action) {
  setBusy(true);
  setError('');

  try {
    if(action==='submit') {
      const problem=validateA(draft);
      if(problem) throw Error(problem);
    }

    const next=await onSave(
      base,draft,action,editReason,reason
    );

    if (!next) {
      setDirty(false);
      onClose();
      return;
    }

    setBase(next);
    setDraft(next);
    setDirty(false);
    setEditing(false);
    setEditReason('');
    setConfirmAction('');
    setReason('');

    if(
      [
        'submit','approve','return','reject','receive',
        'verify','rectify','close'
      ].includes(action)
    ) onClose();

  } catch(e) {
    if(e.latest) {
      setBase(e.latest);
      setDraft(e.latest);
      setDirty(false);
      setEditing(false);
    }

    if(e.reloadRequired) {
      setReloadRequired(true);
      setEditing(false);
    }

    setError(e.message);

    document.querySelector('.modal-content')
      ?.scrollTo({top:0,behavior:'smooth'});

  } finally {
    setBusy(false);
  }
}
function choose(action){if(['return','reject','unable','rectify','reopen'].includes(action)){setConfirmAction(action);setReason('');document.querySelector('.modal-content')?.scrollTo({top:0,behavior:'smooth'});return;}commit(action);}
return <Modal title={draft.title||'New Work Order'} subtitle={`${base.workOrderId}${base.ref?' · '+base.ref:''} · ${base.status==='draft'?'Create request':'Work order details'}`} tag={<div className="status-line"><Status order={base}/>{overdue(base)&&<span className="status status-overdue">Overdue</span>}</div>} onClose={close} footer={<><span className="muted access">{editing?(a&&b?'Editing work order':a?'Editing request':'Editing R&D details'):'Viewing work order'}</span><div className="footer-actions"><button className="btn" disabled={busy} onClick={close}>Close</button>{!editing&&(allowA||allowB)&&<button className="btn secondary" onClick={()=>setEditing(true)}><Pencil size={15}/>{allowA?'Edit request':'Edit details'}</button>}{editing&&(a||b)&&<button className="btn secondary" disabled={busy||!dirty} onClick={()=>commit()}>Save {base.status==='draft'?'draft':'changes'}</button>}{acts.map(action=><button key={action} disabled={busy||(action==='submit'&&!photoOK)} className={'btn '+(['reject','unable','return','rectify','reopen'].includes(action)?'danger-outline':'primary')} onClick={()=>choose(action)}>{labels[action]}</button>)}</div></>}>
<div className="modal-content">{a&&base.status!=='draft'&&base.status!=='correction'&&<div className="edit-notice"><Textarea label={significant?"Reason for change (required)":"Reason for change (required for significant updates)"} value={editReason} onChange={setEditReason}/>{significant&&base.approvedAt&&<p>Saving these changes will return the request for department approval. Previous planning and completion records will remain in the activity history.</p>}</div>}{error&&<div role="alert" className="error">{error}</div>}{confirmAction&&<div className="reason-box"><strong>{labels[confirmAction]}</strong><Textarea label={confirmAction==='rectify'
              ? 'Reason for rework (required)'
              : 'Reason (required)'} value={reason} onChange={setReason}/><div className="actions"><button className="btn" onClick={()=>setConfirmAction('')}>Cancel</button><button className="btn primary" disabled={busy} onClick={()=>commit(confirmAction)}>Confirm</button></div></div>}
<><Section title="Part A · Requester information" tone="purple" icon={User}><div className="form-grid"><Info label="Work Order ID" value={base.workOrderId}/><Input label="Reference No. (manual)" {...bind('ref')} disabled={!a} placeholder="Enter reference number"/><Info label="Issued by" value={draft.issuedBy}/><Info label="Department" value={draft.department}/><Info label="Last updated" value={fmt(base.updatedAt||base.history.at(-1)?.at||base.createdAt)}/><Input label="Section / line *" {...bind('section')} disabled={!a}/><Input label="Request title *" {...bind('title')} disabled={!a}/></div></Section><Section title="Work classification" tone="blue" icon={ClipboardList}><div className="form-grid"><Select label="Work to be done by" {...bind('team')} options={TEAMS} disabled={!a}/><Select label="Priority" {...bind('priority')} options={['Low','Normal','High','Urgent']} disabled={!a}/>{['Production','Others'].includes(draft.team)&&<Input label="Specify team / production" {...bind('teamOther')} disabled={!a} wide/>}<Checks label="Type of work *" options={TYPES} {...bind('types')} disabled={!a}/><Checks label="Reason of request *" options={REASONS} {...bind('reasons')} disabled={!a}/>{draft.types.includes('Others')&&<Input label="Other work type" {...bind('typeOther')} disabled={!a}/>} {draft.reasons.includes('Others')&&<Input label="Other reason" {...bind('reasonOther')} disabled={!a}/>}</div></Section><Section title="Work request details" tone="teal" icon={FileText}><div className="form-grid"><Textarea label="Details of work order request *" {...bind('description')} disabled={!a}/><Input label="Requested completion date *" type="date" {...bind('due')} disabled={!a}/><Select label="Sketch attached?" {...bind('sketch')} options={['Yes','No']} disabled={!a}/></div><Documents
      order={draft}
      user={user}
      editable={a&&
        ['draft','correction'].includes(base.status)}
      onChange={change}
    /></Section><Section title="Approval & receipt" tone="amber" icon={ShieldCheck}><div className="form-grid"><Info label="Requested by" value={base.submittedAt?base.issuedBy:'—'}/><Info label="Requested at" value={fmt(base.submittedAt)}/><Info label="Approved by" value={base.approvedBy}/><Info label="Approval date / time" value={fmt(base.approvedAt)}/><Info label="Received / acknowledged by" value={base.receivedBy}/><Info label="Receipt date / time" value={fmt(base.receivedAt)}/></div></Section></>
<Section title="Part B · R&D evaluation and work planning" tone="blue" icon={CalendarDays}><div className="form-grid"><Select label="Justification on requested work" {...bind('method')} disabled={!planning} options={[...new Set([
      'Internal fabrication',
      'External party',
      ...(!planning&&draft.method?[draft.method]:[])
    ])]}/>
<label className="field">
  <span>Person in charge (R&D head only)</span>

  <select
    value={draft.assignedPic||''}
    disabled={!planning||user.role!=='head'}
    onChange={e=>{
      const selected=pics.find(
        p=>String(p.id)===e.target.value
      );

      change('assignedPic',e.target.value);
      change('pic',selected?.full_name||'');
    }}
  >
    <option value="">Select PIC...</option>

    {draft.assignedPic &&
      !pics.some(p=>String(p.id)===String(draft.assignedPic)) &&
      <option value={draft.assignedPic}>
        {draft.pic||'Assigned PIC'}
      </option>
    }

    {pics.map(p=>
      <option key={p.id} value={p.id}>
        {p.full_name} ({p.employee_id})
      </option>
    )}
  </select>

  {picError&&<small className="error">{picError}</small>}
</label>
{draft.method==='External party'&&<Input label="External party" {...bind('external')} disabled={!planning} wide/>}<Textarea label="Evaluation remarks" {...bind('evaluation')} disabled={!planning}/><Input label="Planned start date / time" type="datetime-local" {...bind('start')} disabled={!planning}/><Input label="Estimated completion date / time" type="datetime-local" {...bind('estimate')} disabled={!planning}/><Info label="Actual start date / time" value={fmt(base.startedAt)}/><Info label="Received date / time" value={fmt(base.receivedAt)}/></div>{!planning&&<p className="muted">Planning is managed by R&D after receipt.</p>}</Section>
<Photos required={a||base.status==='draft'||base.status==='correction'} order={draft} user={user} editA={a} editB={completion} onChange={change}/>
<><Section title="Work completion" tone="green" icon={CheckCircle2}><div className="form-grid"><Select label="Status after work completion" {...bind('outcome')} disabled={!completion} options={['Completed','Use temporarily','Under monitoring']}/><Input label="Actual completion date / time" type="datetime-local" {...bind('actual')} disabled={!completion}/><Textarea label="Justification on status" {...bind('completionRemarks')} disabled={!completion}/><label className="check-line wide"><input type="checkbox" checked={draft.verificationRequired} disabled={!completion} onChange={e=>change('verificationRequired',e.target.checked)}/> Accuracy verification required</label><Info label="Completed by" value={base.completedBy}/><Info label="Completion recorded at" value={fmt(base.completedAt)}/></div></Section><Section title="Verification & requester acknowledgement" tone="amber" icon={ShieldCheck}><div className="form-grid"><Info label="Accuracy verified by" value={base.verifiedBy}/><Info label="Verified date / time" value={fmt(base.verifiedAt)}/><Info label="Acknowledged by requester" value={base.ackBy}/><Info label="Acknowledged date / time" value={fmt(base.ackAt)}/></div></Section></>
{base.photoVersions?.length>0&&
      <Section title="Previous photo versions" icon={Image}>
        {base.photoVersions.map(p=>
          <div key={p.id} className="doc">
            <Image size={18}/>
            <a href={p.url} target="_blank"
               rel="noopener noreferrer">
              {p.name}
            </a>
            <small>{p.kind} · {fmt(p.at)}</small>
          </div>
        )}
      </Section>
    }
    
<Section title="Updates" icon={History}>
  <div style={{
    display:'flex',
    flexDirection:'column',
    gap:'20px',
    padding:'8px 0'
  }}>
    {[...base.history]
      .sort((a,b)=>new Date(b.at)-new Date(a.at))
      .map(h=>
        <article
          key={h.id}
          style={{
            display:'flex',
            alignItems:'flex-start',
            gap:'12px'
          }}
        >
          <span style={{
            width:'10px',
            height:'10px',
            minWidth:'10px',
            borderRadius:'50%',
            background:'#86152B',
            marginTop:'5px'
          }}/>

          <div style={{
            flex:1,
            minWidth:0,
            overflowWrap:'anywhere'
          }}>
            <strong style={{
              fontSize:'14px',
              lineHeight:'1.5'
            }}>
              {updateMessage(h)}
            </strong>

            {h.details &&
              h.details.trim() !== updateMessage(h).trim() &&
              <div style={{
                fontSize:'13px',
                marginTop:'3px',
                whiteSpace:'pre-wrap'
              }}>
                {h.details}
              </div>
            }

            <div style={{
              color:'#64748b',
              fontSize:'11px',
              marginTop:'4px'
            }}>
              {h.by} · {updateTime(h.at)}
            </div>
          </div>
        </article>
      )
    }

    {!base.history.length &&
      <p className="muted">No updates yet.</p>
    }
  </div>
</Section>
</div></Modal>}

const fieldLabel=k=>({ref:'Reference No.',due:'Requested completion date',estimate:'Estimated completion date / time',photos:'Work order photos',documents:'Supporting documents',pic:'Person in charge',actual:'Actual completion',status:'Status'}[k]||k.replace(/([A-Z])/g,' $1').replace(/^./,c=>c.toUpperCase()));
function AuditValue({value}){
      if(value && typeof value==='object' && !Array.isArray(value))
        return <span style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>
          {JSON.stringify(value,null,2)}
        </span>;
    if(Array.isArray(value)&&value.some(v=>v?.blob))return <AuditFiles files={value}/>;if(value===null||value===''||(Array.isArray(value)&&!value.length))return <span>—</span>;return <span>{Array.isArray(value)?value.join(', '):typeof value==='boolean'?(value?'Yes':'No'):String(STATUS[value]||value)}</span>}


function updateMessage(h) {
  const action = String(h.action || '');

  const messages = {
    'Draft created': 'Work order created.',
    'Created': 'Work order created.',
    'Submitted': 'Work order submitted for approval.',
    'Approved': 'Approved by department approver.',
    'Received by R&D': 'Acknowledged by R&D.',
    'Planning updated': 'Work planning details updated.',
    'Work planned': 'Work plan confirmed.',
    'Work started': 'Work started.',
    'Started': 'Work started.',
    'Work completed': 'Work completed.',
    'Completion updated': 'Work completion details updated.',
    'Accuracy verified': 'Work accuracy verified.',
    'Acknowledged and closed':
      'Requester acknowledged and closed the work order.',
    'Returned for correction':
      'Work order returned for correction.',
    'Rejected': 'Work order rejected.',
    'Reopened': 'Work order reopened.',
    'Rectification requested':
      'Rework requested.',
    'Unable to proceed':
      'Work order unable to proceed.'
  };

  if (/photo/i.test(action) && h.photoNames?.length) {
    const names = h.photoNames.join(', ');

    return /replac/i.test(action)
      ? 'Replaced photo: ' + names + '.'
      : 'Uploaded ' + names + '.';
  }

  return messages[action] ||
    (action
      ? action.replace(/[.]+$/, '') + '.'
      : 'Work order updated.');
}

function updateTime(value) {
  if (!value) return '';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return '';

  return new Intl.DateTimeFormat('en-MY', {
    timeZone:'Asia/Kuala_Lumpur',
    day:'numeric',
    month:'short',
    year:'numeric',
    hour:'numeric',
    minute:'2-digit',
    hour12:true
  }).format(date);
}
