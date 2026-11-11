import type { Node, NodeProps } from '@xyflow/react';
import { useEffect, useState, type CSSProperties } from 'react';
import { patchCard, type GithubInfo, type LinkCard } from '../db';
import { Check, ExternalLink, Link2, Lock, RefreshCw, RotateCw, Unlock } from 'lucide-react';
import { CardFrame, nextQuarterTurn, ToolbarButton, useBlobUrl, useCopy } from './CardFrame';
import { useNearView } from '../lib/loadZone';
import { loadPreview, PREVIEW_VERSION } from './linkPreview';

export type LinkNodeType = Node<{ card: LinkCard }, 'link'>;

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function hueOf(host: string) {
  let h = 0;
  for (const ch of host) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

function GithubBadge({ info }: { info: GithubInfo }) {
  return (
    <span className={`gh-badge gh-${info.state}`}>
      {info.kind === 'pull' ? 'PR' : 'Issue'} #{info.number} · {info.state}
    </span>
  );
}

export function LinkNode({ id, data, selected }: NodeProps<LinkNodeType>) {
  const { url, status, preview, error, version, imageBlobId, keepAspect = true } = data.card.data;
  const { near, height } = useNearView(id, data.card.height ?? 300);
  const local = useBlobUrl(near ? imageBlobId : undefined);
  const imageSrc = local.url ?? (imageBlobId ? null : preview?.image); // wait for the local copy if we have one
  const [imageFailed, setImageFailed] = useState(false);
  const [iconFailed, setIconFailed] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const [copied, copy] = useCopy();
  const host = hostOf(url);
  const hasImage = !!preview?.image && !imageFailed;
  // Image-first links (Pinterest pins): the picture fills the card and a small
  // site badge pokes out of the corner as the way to open the link.
  const imageFirst = preview?.display === 'image' && hasImage;

  useEffect(() => setImageFailed(false), [imageSrc]);
  const bannerIcon = !logoFailed && preview?.logo ? preview.logo : !iconFailed ? preview?.favicon : undefined;

  useEffect(() => {
    if (status === 'loading' || (version ?? 1) < PREVIEW_VERSION) void loadPreview(id, url);
  }, [id, url, status, version]);

  const open = () => window.open(url, '_blank', 'noopener,noreferrer');
  const refresh = () => {
    setImageFailed(false);
    setIconFailed(false);
    setLogoFailed(false);
    void patchCard(id, (c) => {
      if (c.type === 'link') c.data.status = 'loading';
    });
  };

  const toolbar = (
    <>
      <ToolbarButton title="Open link" onClick={open}>
        <ExternalLink size={15} />
      </ToolbarButton>
      <ToolbarButton title="Copy URL" onClick={() => copy(() => navigator.clipboard.writeText(url))}>
        {copied ? <Check size={15} /> : <Link2 size={15} />}
      </ToolbarButton>
      {imageFirst && (
        <>
          <ToolbarButton
            title={keepAspect ? 'Aspect ratio locked (click to resize freely)' : 'Keep aspect ratio'}
            active={keepAspect}
            onClick={() =>
              void patchCard(id, (c) => {
                if (c.type !== 'link') return;
                c.data.keepAspect = !keepAspect;
                // Locking again snaps the card back to the picture's real shape.
                if (!keepAspect) c.height = undefined;
              })
            }
          >
            {keepAspect ? <Lock size={15} /> : <Unlock size={15} />}
          </ToolbarButton>
          <ToolbarButton title="Rotate 90°" onClick={() => void patchCard(id, (c) => void (c.rotation = nextQuarterTurn(c.rotation ?? 0)))}>
            <RotateCw size={15} />
          </ToolbarButton>
        </>
      )}
      {!imageFirst && (
        <ToolbarButton title="Refresh preview" onClick={refresh}>
          <RefreshCw size={15} />
        </ToolbarButton>
      )}
    </>
  );

  return (
    <CardFrame
      id={id}
      selected={selected}
      className={`link-card${imageFirst ? ' pin-card' : ''}`}
      minWidth={imageFirst ? 120 : 200}
      keepAspectRatio={imageFirst && keepAspect}
      rotatable={imageFirst}
      rotation={imageFirst ? data.card.rotation : 0}
      minHeight={80}
      toolbar={toolbar}
      // Pins open only from their corner badge (or the toolbar), never by double-click.
      onDoubleClick={imageFirst ? undefined : open}
      outside={
        imageFirst && (
          <a
            className="site-badge nodrag"
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            title={`Open on ${preview?.siteName ?? host}`}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            {preview?.favicon && !iconFailed ? (
              <img src={preview.favicon} alt="" referrerPolicy="no-referrer" onError={() => setIconFailed(true)} />
            ) : (
              <span>{(preview?.siteName ?? host)[0]?.toUpperCase()}</span>
            )}
          </a>
        )
      }
    >
      {!near ? (
        <div className="card-lite" style={{ height }} />
      ) : imageFirst ? (
        <div className="pin-image">
          {imageSrc ? (
            <img src={imageSrc} alt={preview?.title ?? ''} draggable={false} referrerPolicy="no-referrer" onError={() => setImageFailed(true)} />
          ) : (
            <div className="pin-loading" />
          )}
        </div>
      ) : (
      <>
      {hasImage ? (
        <div className="link-image">
          {imageSrc && (
            <img src={imageSrc} alt="" draggable={false} referrerPolicy="no-referrer" onError={() => setImageFailed(true)} />
          )}
        </div>
      ) : (
        status !== 'loading' && (
          // No social image: a banner tinted per-site so cards still read at a glance when zoomed out.
          <div className="link-banner" style={{ '--site-hue': hueOf(host) } as CSSProperties}>
            {bannerIcon ? (
              <img
                src={bannerIcon}
                alt=""
                draggable={false}
                referrerPolicy="no-referrer"
                onError={() => (bannerIcon === preview?.logo ? setLogoFailed(true) : setIconFailed(true))}
              />
            ) : (
              <span className="link-banner-letter">{host[0]?.toUpperCase()}</span>
            )}
            <span className="link-banner-host">{host}</span>
          </div>
        )
      )}
      <div className="link-body">
        <div className="link-site">
          {preview?.favicon && !iconFailed ? (
            <img className="link-favicon" src={preview.favicon} alt="" referrerPolicy="no-referrer" onError={() => setIconFailed(true)} />
          ) : (
            <span className="link-favicon fallback" />
          )}
          <span className="link-site-name">{preview?.siteName ?? host}</span>
          {preview?.github && <GithubBadge info={preview.github} />}
        </div>
        <div className={`link-title${status === 'loading' ? ' loading' : ''}`}>
          {status === 'loading' ? 'Loading preview…' : (preview?.title ?? host)}
        </div>
        {preview?.description && <div className="link-desc">{preview.description}</div>}
        {status === 'error' && <div className="link-error">Preview unavailable: {error}</div>}
        <a className="link-url nodrag" href={url} target="_blank" rel="noopener noreferrer">
          {url}
        </a>
      </div>
      </>
      )}
    </CardFrame>
  );
}
