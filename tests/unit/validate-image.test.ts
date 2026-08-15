import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { ImageValidationError, validateImage } from "@/lib/images/validate-image";

async function image(
  width: number,
  height: number,
  format: "jpeg" | "png",
): Promise<Uint8Array> {
  const pipeline = sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 34, g: 82, b: 67 },
    },
  });
  return format === "jpeg" ? pipeline.jpeg().toBuffer() : pipeline.png().toBuffer();
}

async function expectCode(promise: Promise<unknown>, code: ImageValidationError["code"]) {
  await expect(promise).rejects.toMatchObject({
    name: "ImageValidationError",
    code,
  });
}

describe("validateImage", () => {
  it.each([
    ["jpeg", "image/jpeg"],
    ["png", "image/png"],
  ] as const)("accepts a valid %s signature and returns normalized metadata", async (format, mime) => {
    const bytes = await image(512, 384, format);

    await expect(validateImage(bytes, mime)).resolves.toEqual({
      contentType: mime,
      width: 512,
      height: 384,
      byteSize: bytes.byteLength,
    });
  });

  it("rejects a declared MIME type that does not match the byte signature", async () => {
    const png = await image(512, 384, "png");
    await expectCode(validateImage(png, "image/jpeg"), "unsupported_type");
  });

  it("rejects unsupported signatures and declared types", async () => {
    await expectCode(validateImage(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39]), "image/gif"), "unsupported_type");
  });

  it("requires the file to be strictly smaller than 10,000,000 bytes", async () => {
    const bytes = new Uint8Array(10_000_000);
    bytes.set([0xff, 0xd8, 0xff]);
    await expectCode(validateImage(bytes, "image/jpeg"), "too_large");
  });

  it("enforces the minimum 512 by 384 dimensions", async () => {
    await expectCode(validateImage(await image(511, 384, "png"), "image/png"), "too_small");
    await expectCode(validateImage(await image(512, 383, "png"), "image/png"), "too_small");
  });

  it("rejects either side above 4096 pixels", async () => {
    await expectCode(
      validateImage(await image(4_097, 384, "png"), "image/png"),
      "too_large_dimensions",
    );
  });

  it("normalizes Sharp metadata failures to an actionable unreadable error", async () => {
    const corruptPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

    try {
      await validateImage(corruptPng, "image/png");
      expect.fail("Expected corrupt image validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ImageValidationError);
      expect(error).toMatchObject({ code: "unreadable" });
      expect((error as ImageValidationError).guidance.length).toBeGreaterThan(20);
      expect((error as Error).message).not.toContain("pngload");
    }
  });
});
