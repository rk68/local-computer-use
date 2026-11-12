import { useEffect, useRef, useState } from 'react';
import { Icon } from '../components/Icon';

export type SavedScreenshot = { id: string; messageId: string; order?: number; caption: string; createdAt: number };
export function ScreenshotCard({ image, token, threadId }: { image: SavedScreenshot; token: string; threadId: string }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const controller = new AbortController(); let objectUrl = '';
    setUrl(''); setError('');
    void (async () => {
      const response = await fetch('/api/artifacts/' + image.id, { headers: { 'X-Local-Token': token, 'X-Halo-Thread': threadId }, signal: controller.signal });
      if (!response.ok || response.headers.get('Content-Type') !== 'image/png') throw new Error('Saved screenshot is unavailable on this Mac.');
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob); setUrl(objectUrl);
    })().catch(failure => { if (!controller.signal.aborted) setError(failure.message); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [image.id, token, threadId]);
  return <figure className="screenshot-card">
    {url ? <button className="screenshot-preview" aria-label="Expand shared screenshot" onClick={() => dialog.current?.showModal()}><img src={url} alt={image.caption} loading="lazy" /><span><Icon name="expand" /> Expand screenshot</span></button> : <div className="screenshot-placeholder" role={error ? 'alert' : 'status'}>{error || 'Loading screenshot…'}</div>}
    <figcaption><span><Icon name="camera" /> Saved in this thread</span>{url ? <a href={url} download={`halo-${image.id}.png`}><Icon name="download" /> Save PNG</a> : null}</figcaption>
    <dialog ref={dialog} className="desktop-dialog screenshot-dialog" aria-label="Shared screenshot">
      <div className="dialog-heading"><h2>{image.caption}</h2><button className="dialog-close" aria-label="Close shared screenshot" onClick={() => dialog.current?.close()}><Icon name="close" /></button></div>
      {url ? <div className="expanded-screen"><img src={url} alt={image.caption} /></div> : null}
    </dialog>
  </figure>;
}
