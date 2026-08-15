import type { AllowedImageContentType } from "@/lib/images/validate-image";

export interface ObjectStore {
  putPrivate(input: {
    key: string;
    bytes: Uint8Array;
    contentType: AllowedImageContentType;
  }): Promise<void>;
  getPrivate(key: string): Promise<{ bytes: Uint8Array; contentType: string }>;
  delete(key: string): Promise<void>;
  createReadUrl(key: string, expiresInSeconds: number): Promise<string>;
}
