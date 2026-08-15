import { z } from "zod";

const uploadRequestSchema = z.object({
  method: z.literal("PUT"),
  url: z.url(),
  headers: z.record(z.string(), z.string()),
});

export const fileRegistrationResponseSchema = z.object({
  status: z.literal(200),
  data: z.object({
    files: z
      .array(
        z.object({
          content_type: z.enum(["image/jpg", "image/png"]),
          file_name: z.string().min(1),
          file_id: z.string().min(1),
          requests: z.array(uploadRequestSchema).min(1),
        }),
      )
      .min(1),
  }),
});

export const taskCreatedResponseSchema = z.object({
  status: z.literal(200),
  data: z.object({
    task_id: z.string().min(1),
  }),
});

const runningTaskResponseSchema = z.object({
  status: z.literal(200),
  data: z.object({
    task_status: z.enum(["queued", "running", "processing"]),
  }),
});

const successfulTaskResponseSchema = z.object({
  status: z.literal(200),
  data: z.object({
    task_status: z.literal("success"),
    error: z.null().optional(),
    results: z.object({
      url: z.url(),
    }),
  }),
});

const failedTaskResponseSchema = z.object({
  status: z.literal(200),
  data: z.object({
    task_status: z.literal("error"),
    error: z.string().min(1),
    error_message: z.string().optional(),
  }),
});

export const taskStatusResponseSchema = z.union([
  runningTaskResponseSchema,
  successfulTaskResponseSchema,
  failedTaskResponseSchema,
]);

export type FileRegistrationResponse = z.infer<typeof fileRegistrationResponseSchema>;
export type TaskCreatedResponse = z.infer<typeof taskCreatedResponseSchema>;
export type TaskStatusResponse = z.infer<typeof taskStatusResponseSchema>;
