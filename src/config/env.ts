import { z } from 'zod';

/**
 * Environment configuration schema.
 * Per product principles: every model ID is read from environment variables
 * and never hard-coded in application code.
 */
export const EnvSchema = z
  .object({
    GOOGLE_CLOUD_PROJECT: z.string().min(1),
    GOOGLE_CLOUD_REGION: z.string().min(1),
    FIREBASE_PROJECT_ID: z.string().min(1),
    LOW_KMS_KEY_NAME: z.string().min(1),
    LOW_APPROVAL_SECRET: z.string().min(16),
    LOW_REASONING_MODEL: z.string().min(1),
    LOW_TRANSCRIPTION_MODEL: z.string().min(1),
    LOW_EMBEDDING_MODEL: z.string().min(1),
    LOW_STORAGE_BUCKET: z.string().min(1),
  })
  .strict();

export type LowEnv = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): LowEnv {
  return EnvSchema.parse({
    GOOGLE_CLOUD_PROJECT: source.GOOGLE_CLOUD_PROJECT,
    GOOGLE_CLOUD_REGION: source.GOOGLE_CLOUD_REGION,
    FIREBASE_PROJECT_ID: source.FIREBASE_PROJECT_ID,
    LOW_KMS_KEY_NAME: source.LOW_KMS_KEY_NAME,
    LOW_APPROVAL_SECRET: source.LOW_APPROVAL_SECRET,
    LOW_REASONING_MODEL: source.LOW_REASONING_MODEL,
    LOW_TRANSCRIPTION_MODEL: source.LOW_TRANSCRIPTION_MODEL,
    LOW_EMBEDDING_MODEL: source.LOW_EMBEDDING_MODEL,
    LOW_STORAGE_BUCKET: source.LOW_STORAGE_BUCKET,
  });
}
