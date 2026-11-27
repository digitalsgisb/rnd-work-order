import DocumentPreview from "./DocumentPreview.jsx";
import React,{useEffect,useRef,useState} from 'react';
import {ImagePlus,CheckCircle2,FileText,Trash2,Upload} from 'lucide-react';
import {id,stamp,fmt,validBeforePhoto} from '../workflow.js';
export function useBlob(blob){const [url,setUrl]=useState('');useEffect(()=>{if(!blob){setUrl('');return;}const u=URL.createObjectURL(blob);setUrl(u);return()=>URL.revokeObjectURL(u);},[blob]);return url;}
function Thumb({file,editable,onReplace,onRemove,onOpen,onDescription}){const url=useBlob(file.blob);const ref=useRef();return <article className="photo"><button className="photo-preview" onClick={()=>onOpen(file)} aria-label={'Enlarge '+file.name}>{url&&<img src={url} alt={file.description||file.name}/>}</button><strong title={file.name}>{file.name}</strong><small>{file.kind==='inspection'?'R&D inspection':file.kind==='before'?'Requester photo':'Completion photo'}</small><small>{file.by} · {fmt(file.at)}</small>

    {editable && !file.serverId &&
      ['inspection','after'].includes(file.kind) ? (
        <label style={{
          display:'flex',
          flexDirection:'column',
          gap:'6px',
          marginTop:'10px'
        }}>
          <small>
            Photo description
            <span className="required"> *</span>
          </small>

          <textarea
            rows={3}
            value={file.description||''}
            placeholder="Describe the work shown in this photo..."
            onChange={e=>onDescription(e.target.value)}
            style={{
              width:'100%',
              boxSizing:'border-box',
              padding:'10px',
              border:'1px solid #cbd5e1',
              borderRadius:'8px',
              resize:'vertical',
              fontFamily:'inherit',
              fontSize:'13px'
            }}
          />
        </label>
      ) : file.description ? (
        <small>{file.description}</small>
      ) : null
    }
    {editable&&<div className="photo-actions"><input hidden type="file" accept="image/jpeg,image/png,image/webp" ref={ref} onChange={e=>{if(e.target.files[0])onReplace(e.target.files[0]);e.target.value='';}}/><button className="btn small" onClick={()=>ref.current.click()}><ImagePlus size={15}/> Replace</button>{!file.serverId&&!file.replacesId&&
      <button
        className="icon-button"
        aria-label="Remove photo"
        onClick={onRemove}
      >
        <Trash2 size={16}/>
      </button>
    }</div>}</article>}
const MAX=8*1024*1024;const IMG=['image/jpeg','image/png','image/webp'];
function pack(file,kind,user){if(!file.size)throw Error('The selected file is empty.');if(file.size>MAX)throw Error(`${file.name}: maximum size is 8 MB.`);if(!(kind==='document'?(
  [...IMG,'application/pdf'].includes(file.type) ||
  (
    (!file.type||file.type==='application/octet-stream') &&
    /\.(pdf|jpe?g|png|webp)$/i.test(file.name)
  )
):IMG.includes(file.type)))throw Error('Only JPEG, PNG, WebP and (for documents) PDF are supported.');return {id:id(),name:file.name,kind,blob:file,description:'',by:user.name,at:stamp()};}
export default function Photos({order,user,editA,editB,onChange,required=false}){const [error,setError]=useState('');const [view,setView]=useState(null);const preview=useBlob(view?.blob);const photoRef=useRef(null);useEffect(()=>{if(view)photoRef.current?.showModal();else photoRef.current?.close();},[view]);function add(files,kind){try{const incoming=Array.from(files).map(f=>pack(f,kind,user));onChange('photos',[...order.photos,...incoming]);setError('');}catch(e){setError(e.message);}}function replace(old,file){try{const p=pack(file,old.kind,user);
    p.replacesId=old.serverId||old.replacesId||null;
    p.description=old.description||'';onChange('photos',order.photos.map(x=>x.id===old.id?p:x));setError('');}catch(e){setError(e.message);}}function remove(old){if(window.confirm('Remove this photo?'))onChange('photos',order.photos.filter(x=>x.id!==old.id));}return <div className="photo-section"><h3>Work Order Photos</h3><p className="muted">Compare the original condition and completed work. Maximum 8 MB per image.</p>{error&&<div className="error" role="alert">{error}</div>}<div className="photo-columns">{[{name:'Before work',kind:'before',tone:'rose',allow:editA,files:order.photos.filter(p=>p.kind==='before'||p.kind==='inspection')},{name:'After work',kind:'after',tone:'green',allow:editB,files:order.photos.filter(p=>p.kind==='after')}].map(({name,kind,tone,allow,files})=><section className={'photo-panel '+tone} key={kind}><header><span className="photo-icon">{kind==='before'?<ImagePlus/>:<CheckCircle2/>}</span><div><h3>{name}{kind==='before'&&required&&<span className="required"> *</span>}</h3><small>{kind==='before'?'Original condition and inspection evidence':'Completed work and final condition'}</small></div><span className="count">{files.length}</span></header><div className="photo-grid">{files.map(f=><Thumb key={f.id} file={f} editable={f.kind==='before'?editA:editB} onReplace={file=>replace(f,file)} onRemove={()=>remove(f)}
    onDescription={value=>onChange(
      'photos',
      order.photos.map(p=>
        p.id===f.id
          ? {...p,description:value}
          : p
      )
    )}
    onOpen={setView}/>)}{(allow||(kind==='before'&&editB))&&<label className="upload" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();add(e.dataTransfer.files,kind==='before'&&editB&&!editA?'inspection':kind);}}><ImagePlus size={24}/><strong>{kind==='before'&&editB&&!editA?'Add inspection photos':'Add photos'}</strong><small>JPG, PNG, WebP</small><input type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={e=>{add(e.target.files,kind==='before'&&editB&&!editA?'inspection':kind);e.target.value='';}}/></label>}{!files.length&&!allow&&!(kind==='before'&&editB)&&<div className="empty-photo">No photos uploaded</div>}</div>{kind==='before'&&!editA&&<div className="photo-note">Requester photos</div>}</section>)}</div>{required&&!order.photos.some(validBeforePhoto)&&<p className="photo-required" role="status">Please upload at least one photo of the original condition or work requirement.</p>}<dialog ref={photoRef} className="image-dialog" onCancel={e=>{e.preventDefault();setView(null);}} onClick={e=>{if(e.target===photoRef.current)setView(null);}}><div><button className="btn" onClick={()=>setView(null)}>Close image</button>{preview&&<img src={preview} alt={view?.name}/>}<p>{view?.name}</p></div></dialog></div>}

function documentSize(bytes) {
  if (!bytes) return '';

  if (bytes >= 1024 * 1024) {
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  return Math.ceil(bytes / 1024) + ' KB';
}

function Doc({file,editable,onRemove,onPreview}) {
  const preview = useBlob(file.blob);
  const url = file.url || preview;
  const saved = !!file.serverId;

  return (
    <div className="supporting-document">

      <FileText size={22}/>

      <div className="document-details">

        <a
          href={url||undefined}
          download={file.name}
        >
          {file.name}
        </a>

        <small>
          {documentSize(file.size||file.blob?.size)}
          {' · '}
          {saved ? file.by : 'Pending upload'}
        </small>

        {saved&&file.at&&
          <small>{fmt(file.at)}</small>
        }

      </div>

      <button
        type="button"
        className="btn small"
        onClick={onPreview}
      >
        Preview
      </button>

      {saved ? (
        <a
          href={url}
          download={file.name}
          className="btn small"
        >
          Download
        </a>
      ) : editable ? (
        <button
          className="icon-button"
          onClick={onRemove}
          aria-label="Remove unsaved document"
        >
          <Trash2 size={18}/>
        </button>
      ) : null}

    </div>
  );
}

export function Documents({
  order,user,editable,onChange
}) {
  const [error,setError]=useState('');
  const documents=order.documents||[];
  const [previewId,setPreviewId]=useState(null);

  const previewFile=documents.find(
    d=>d.id===previewId
  );

  function addDocuments(incoming) {
    try {
      const selected=Array.from(incoming);

      if(documents.length+selected.length>10) {
        throw Error(
          'Maximum 10 documents per work order.'
        );
      }

      const files=selected.map(
        file=>pack(file,'document',user)
      );

      onChange('documents',[
        ...documents,...files
      ]);

      setError('');

    } catch(err) {
      setError(err.message);
    }
  }

  return (
    <div className="supporting-documents">

      <div className="document-heading">
        <h3>Supporting documents</h3>
        <small>{documents.length}/10 files</small>
      </div>

      {documents.map(file=>
        <Doc
          key={file.id}
          file={file}
          editable={editable}
          onPreview={()=>setPreviewId(file.id)}
          onRemove={()=>onChange(
            'documents',
            documents.filter(d=>d.id!==file.id)
          )}
        />
      )}

      {previewFile&&
        <DocumentPreview
          key={previewFile.id}
          file={previewFile}
          onClose={()=>setPreviewId(null)}
        />
      }

      {editable&&documents.length<10&&
        
<label className="upload document-upload">
  <Upload size={22}/>

  <strong>Attach supporting documents</strong>

  <small>
    PDF, JPG, PNG, WebP · Max 8 MB each
  </small>

  <input
    type="file"
    multiple
    accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
    onChange={e=>{
      addDocuments(e.target.files);
      e.target.value='';
    }}
  />
</label>

      }

      {!editable&&!documents.length&&
        <p className="muted">
          No supporting documents.
        </p>
      }

      {editable&&
        <small className="muted">
          New files will be uploaded when you save
          or submit the request.
        </small>
      }

      {error&&
        <p className="error" role="alert">
          {error}
        </p>
      }

    </div>
  );
}

export function AuditFiles({files}){return <div className="audit-files">{files.map(f=><AuditFile key={f.id} file={f}/>)}</div>}
function AuditFile({file}){const url=useBlob(file.blob);return <a href={url||undefined} download={file.name} className="audit-file">{url&&file.kind!=='document'&&<img src={url} alt={file.name}/>}<span>{file.name}</span></a>}
