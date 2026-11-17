// Riduce la foto sul dispositivo prima dell'invio: meno dati verso il fornitore, meno token, meno costo.
// Disegna su un canvas (orientamento corretto, sfondo bianco) e ricodifica in JPEG.
import { fitWithin, type AiImage, type FitLimits } from "@/core/ai";

/** Uno scontrino lungo e stretto ha bisogno di altezza: il limite è sull'area, oltre che sul lato. */
export const RECEIPT_IMAGE_LIMITS: FitLimits = { maxSide: 2400, maxPixels: 2_500_000 };

/** Le foto di un ripiano sono più grandi e più d'una per volta: meno pixel ciascuna, per tenere basso il costo. */
export const PANTRY_IMAGE_LIMITS: FitLimits = { maxSide: 1800, maxPixels: 1_800_000 };

const MAX_BYTES = 3_500_000;

export interface PreparedImage {
  image: AiImage;
  /** Per l'anteprima. */
  blob: Blob;
  width: number;
  height: number;
  /** Dimensioni dell'originale, per mostrare quanto si è ridotto. */
  originalBytes: number;
}

export class ImageError extends Error {
  readonly kind: "not_image" | "decode" | "encode";
  constructor(kind: "not_image" | "decode" | "encode") {
    super(`image_error:${kind}`);
    this.name = "ImageError";
    this.kind = kind;
  }
}

export const IMAGE_ERROR_MESSAGES: Record<ImageError["kind"], string> = {
  not_image: "Il file scelto non è un'immagine.",
  decode: "Non riesco ad aprire questa immagine. Prova con una foto in formato JPEG o PNG.",
  encode: "Non sono riuscito a ridurre la foto. Riprova con un'altra.",
};

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

async function decode(file: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch {
      // si prova con l'elemento immagine
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new ImageError("decode");
  }
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new ImageError("encode"))), "image/jpeg", quality);
  });
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new ImageError("encode"));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      if (comma >= 0) resolve(result.slice(comma + 1));
      else reject(new ImageError("encode"));
    };
    reader.readAsDataURL(blob);
  });
}

export async function prepareImage(file: File, limits: FitLimits = RECEIPT_IMAGE_LIMITS): Promise<PreparedImage> {
  if (!file.type.startsWith("image/")) throw new ImageError("not_image");
  const decoded = await decode(file);
  try {
    const size = fitWithin(decoded.width, decoded.height, limits);
    if (size.width === 0) throw new ImageError("decode");
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) throw new ImageError("encode");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, size.width, size.height);
    context.drawImage(decoded.source, 0, 0, size.width, size.height);

    let quality = 0.85;
    let blob = await toBlob(canvas, quality);
    while (blob.size > MAX_BYTES && quality > 0.5) {
      quality -= 0.1;
      blob = await toBlob(canvas, quality);
    }
    return {
      image: { mediaType: "image/jpeg", dataBase64: await toBase64(blob) },
      blob,
      width: size.width,
      height: size.height,
      originalBytes: file.size,
    };
  } finally {
    decoded.release();
  }
}
