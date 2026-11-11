import type { Node, NodeProps } from '@xyflow/react';
import { patchCard, type ImageCard } from '../db';
import { Check, Copy, ExternalLink, RotateCw, Scaling } from 'lucide-react';
import { useNearView } from '../lib/loadZone';
import { CardFrame, nextQuarterTurn, ToolbarButton, useBlobUrl, useCopy } from './CardFrame';
import { isSvg } from './create';

export type ImageNodeType = Node<{ card: ImageCard }, 'image'>;

/** Clipboard only takes PNG; convert anything else (incl. SVG, rendered at 2x). */
async function toPng(blob: Blob, fallback: { w: number; h: number }): Promise<Blob> {
  if (blob.type === 'image/png') return blob;
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = isSvg(blob) ? 2 : 1;
    const w = (img.naturalWidth || fallback.w) * scale;
    const h = (img.naturalHeight || fallback.h) * scale;
    const canvas = new OffscreenCanvas(w, h);
    canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
    return canvas.convertToBlob({ type: 'image/png' });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function ImageNode({ id, data, selected }: NodeProps<ImageNodeType>) {
  const { blobId, naturalWidth, naturalHeight, name } = data.card.data;
  // Far from the view: drop the decoded image entirely (the placeholder keeps its shape).
  const { near } = useNearView(id, (data.card.width * naturalHeight) / naturalWidth);
  const { url, blob } = useBlobUrl(near ? blobId : undefined);
  const [copied, copy] = useCopy();

  const toolbar = blob && (
    <>
      <ToolbarButton
        title="Copy image"
        onClick={() =>
          copy(async () => {
            const png = await toPng(blob, { w: naturalWidth, h: naturalHeight });
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
          })
        }
      >
        {copied ? <Check size={15} /> : <Copy size={15} />}
      </ToolbarButton>
      <ToolbarButton title="Open full size" onClick={() => url && window.open(url, '_blank', 'noopener')}>
        <ExternalLink size={15} />
      </ToolbarButton>
      <ToolbarButton
        title="Reset to 100%"
        onClick={() =>
          void patchCard(id, (c) => {
            c.width = Math.round(naturalWidth / (isSvg(blob) ? 1 : window.devicePixelRatio || 1));
            c.height = undefined;
          })
        }
      >
        <Scaling size={15} />
      </ToolbarButton>
      <ToolbarButton title="Rotate 90°" onClick={() => void patchCard(id, (c) => void (c.rotation = nextQuarterTurn(c.rotation ?? 0)))}>
        <RotateCw size={15} />
      </ToolbarButton>
    </>
  );

  return (
    <CardFrame
      id={id}
      selected={selected}
      className="image-card"
      keepAspectRatio
      minWidth={60}
      minHeight={40}
      toolbar={toolbar}
      rotatable
      rotation={data.card.rotation}
    >
      {url ? (
        <img src={url} alt={name ?? 'Pasted image'} draggable={false} />
      ) : (
        <div className="image-placeholder" style={{ aspectRatio: `${naturalWidth} / ${naturalHeight}` }} />
      )}
    </CardFrame>
  );
}
