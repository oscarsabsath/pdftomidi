import * as pdfjsLib from 'pdfjs-dist';

// Configure local bundled worker for Vite so it works 100% offline/client-side
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

export interface RenderedSheetPage {
  pageIndex: number;
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

/**
 * Render a PDF file to high-resolution canvases (up to maxPages) for OMR processing.
 */
export async function renderPdfToCanvases(
  file: File,
  onProgress?: (page: number, total: number) => void,
  maxPages = 10
): Promise<RenderedSheetPage[]> {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });
  const pdf = await loadingTask.promise;
  const totalPages = Math.min(pdf.numPages, maxPages);
  const pages: RenderedSheetPage[] = [];

  for (let p = 1; p <= totalPages; p++) {
    onProgress?.(p, totalPages);
    const page = await pdf.getPage(p);
    const baseViewport = page.getViewport({ scale: 1 });
    // Target ~1600px width for optimal staff line & notehead resolution
    const targetScale = Math.min(3.2, Math.max(1.8, 1650 / Math.max(1, baseViewport.width)));
    const viewport = page.getViewport({ scale: targetScale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({
      canvasContext: ctx,
      viewport,
    }).promise;

    pages.push({
      pageIndex: p - 1,
      canvas,
      width: canvas.width,
      height: canvas.height,
    });
  }

  return pages;
}

/**
 * Load an image file (JPG/PNG/WebP) onto an appropriately scaled canvas for OMR processing.
 */
export async function loadImageToCanvas(file: File): Promise<RenderedSheetPage[]> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('No se pudo cargar la imagen de la partitura.'));
      el.src = url;
    });

    // Normalize width between 1200 and 2000 px so OMR kernels operate at consistent resolution
    let targetW = img.naturalWidth;
    let targetH = img.naturalHeight;
    if (targetW < 1200) {
      const scale = 1400 / Math.max(1, targetW);
      targetW = Math.round(targetW * scale);
      targetH = Math.round(targetH * scale);
    } else if (targetW > 2100) {
      const scale = 1800 / targetW;
      targetW = Math.round(targetW * scale);
      targetH = Math.round(targetH * scale);
    }

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetW, targetH);
    ctx.drawImage(img, 0, 0, targetW, targetH);

    return [
      {
        pageIndex: 0,
        canvas,
        width: targetW,
        height: targetH,
      },
    ];
  } finally {
    URL.revokeObjectURL(url);
  }
}
