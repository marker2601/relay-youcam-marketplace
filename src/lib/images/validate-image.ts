import sharp from "sharp";

export type AllowedImageContentType = "image/jpeg" | "image/png";
export type ImageValidationCode =
  | "unsupported_type"
  | "too_large"
  | "too_small"
  | "too_large_dimensions"
  | "unreadable";

export interface ValidatedImage {
  contentType: AllowedImageContentType;
  width: number;
  height: number;
  byteSize: number;
}

const guidance: Record<ImageValidationCode, string> = {
  unsupported_type: "Choose a JPEG or PNG image whose file type matches its contents.",
  too_large: "Choose an image smaller than 10 MB, then try again.",
  too_small: "Choose an image at least 512 pixels wide and 384 pixels tall.",
  too_large_dimensions: "Resize the image so neither side is larger than 4096 pixels.",
  unreadable: "This image could not be read. Export it again as a standard JPEG or PNG.",
};

export class ImageValidationError extends Error {
  readonly code: ImageValidationCode;
  readonly guidance: string;

  constructor(code: ImageValidationCode) {
    super(`Image validation failed: ${code}`);
    this.name = "ImageValidationError";
    this.code = code;
    this.guidance = guidance[code];
  }
}

function hasPrefix(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((value, index) => bytes[index] === value);
}

function contentTypeFromSignature(bytes: Uint8Array): AllowedImageContentType | null {
  if (hasPrefix(bytes, [0xff, 0xd8, 0xff])) {
    return "image/jpeg";
  }
  if (hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  return null;
}

export async function validateImage(
  bytes: Uint8Array,
  declaredContentType: string,
): Promise<ValidatedImage> {
  if (bytes.byteLength >= 10_000_000) {
    throw new ImageValidationError("too_large");
  }

  const detectedContentType = contentTypeFromSignature(bytes);
  if (
    detectedContentType === null ||
    declaredContentType !== detectedContentType ||
    (declaredContentType !== "image/jpeg" && declaredContentType !== "image/png")
  ) {
    throw new ImageValidationError("unsupported_type");
  }

  let width: number | undefined;
  let height: number | undefined;
  try {
    const metadata = await sharp(bytes, { failOn: "error" }).metadata();
    width = metadata.width;
    height = metadata.height;
  } catch {
    throw new ImageValidationError("unreadable");
  }

  if (width === undefined || height === undefined) {
    throw new ImageValidationError("unreadable");
  }
  if (width < 512 || height < 384) {
    throw new ImageValidationError("too_small");
  }
  if (width > 4_096 || height > 4_096) {
    throw new ImageValidationError("too_large_dimensions");
  }

  return {
    contentType: detectedContentType,
    width,
    height,
    byteSize: bytes.byteLength,
  };
}
