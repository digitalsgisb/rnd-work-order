import { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions }
  from 'pdfjs-dist/legacy/build/pdf.mjs';

import workerUrl
  from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;

export default function DocumentPreview({file,onClose}) {
  const [pdf,setPdf] = useState(null);
  const [page,setPage] = useState(1);
  const [image,setImage] = useState('');
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');

  const canvasHost = useRef(null);

  const mime = file.mimeType || file.blob?.type || '';

  const isPdf = mime === 'application/pdf' ||
    /\.pdf$/i.test(file.name);

  useEffect(()=>{
    let active = true;
    let task;
    let objectUrl;

    const controller = new AbortController();

    async function load() {
      try {
        let blob = file.blob;

        if(!blob) {
          const response = await fetch(file.url,{
            credentials:'same-origin',
            cache:'no-store',
            signal:controller.signal
          });

          if(!response.ok) {
            throw Error('Unable to retrieve document.');
          }

          blob = await response.blob();
        }

        if(!active) return;

        if(isPdf) {
          const data = new Uint8Array(
            await blob.arrayBuffer()
          );

          if(!active) return;

          task = getDocument({
            data,
            isEvalSupported:false,
            enableXfa:false,
            useWasm:false
          });

          const document = await task.promise;

          if(active) setPdf(document);

        } else {
          objectUrl = URL.createObjectURL(blob);

          if(active) setImage(objectUrl);
        }

      } catch(err) {
        if(active) setError(
          'Unable to preview document. ' + err.message
        );
      } finally {
        if(active) setLoading(false);
      }
    }

    load();

    return ()=>{
      active = false;
      controller.abort();

      if(task) task.destroy().catch(()=>{});

      if(objectUrl) URL.revokeObjectURL(objectUrl);
    };
  },[file,isPdf]);

  useEffect(()=>{
    if(!pdf || !canvasHost.current) return;

    let active = true;
    let renderTask;

    async function render() {
      try {
        const current = await pdf.getPage(page);

        if(!active) return;

        const original = current.getViewport({scale:1});

        const scale = Math.min(
          2,
          1600 / Math.max(original.width,original.height)
        );

        const viewport = current.getViewport({scale});

        const canvas = document.createElement('canvas');

        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);

        renderTask = current.render({
          canvas,
          canvasContext:canvas.getContext('2d'),
          viewport
        });

        await renderTask.promise;

        if(active && canvasHost.current) {
          canvasHost.current.replaceChildren(canvas);
        }

      } catch(err) {
        if(active) setError(
          'Unable to render PDF page. ' + err.message
        );
      }
    }

    setError('');
    canvasHost.current.replaceChildren();
    render();

    return ()=>{
      active = false;
      if(renderTask) renderTask.cancel();
    };

  },[pdf,page]);

  return (
    <section className="document-preview">

      <div className="document-preview-header">
        <strong>{file.name}</strong>

        <button
          type="button"
          className="btn small"
          onClick={onClose}
        >
          Close preview
        </button>
      </div>

      {loading && <p>Loading document...</p>}

      {error && <p className="error">{error}</p>}

      {isPdf && (
        <div
          className="document-canvas"
          ref={canvasHost}
        />
      )}

      {!isPdf && image && (
        <div className="document-canvas">
          <img src={image} alt={file.name}/>
        </div>
      )}

      {pdf && (
        <div className="document-pagination">

          <button
            type="button"
            className="btn small"
            disabled={page<=1}
            onClick={()=>setPage(p=>p-1)}
          >
            Previous
          </button>

          <span>Page {page} of {pdf.numPages}</span>

          <button
            type="button"
            className="btn small"
            disabled={page>=pdf.numPages}
            onClick={()=>setPage(p=>p+1)}
          >
            Next
          </button>

        </div>
      )}

    </section>
  );
}
