import { z } from "zod";

const baseServerEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  APP_TIME_ZONE: z.literal("America/Chicago"),
  DEMO_MODE: z
    .enum(["true", "false"])
    .transform((value) => value === "true"),
  YOUCAM_BASE_URL: z.url().default("https://yce-api-01.makeupar.com"),
});

export const serverEnvSchema = z.discriminatedUnion("YOUCAM_MODE", [
  baseServerEnvSchema.extend({
    YOUCAM_MODE: z.literal("fake"),
  }),
  baseServerEnvSchema.extend({
    YOUCAM_MODE: z.literal("live"),
    YOUCAM_API_KEY: z.string().min(20),
  }),
]);

export const publicEnvSchema = z.object({});

export type ServerEnv = z.infer<typeof serverEnvSchema>;
export type PublicEnv = z.infer<typeof publicEnvSchema>;

export function getServerEnv(
  source: Record<string, string | undefined> = process.env,
): ServerEnv {
  return serverEnvSchema.parse(source);
}
