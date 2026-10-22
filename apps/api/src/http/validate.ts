import type { z } from 'zod';
import { AppError } from './errors.js';

/** Parse with a Zod schema; failures become a 422 with a field -> message map (nothing is saved). */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '_form';
    fields[key] ??= issue.message;
  }
  throw new AppError(422, 'validation_error', 'Please fix the highlighted fields', { fields });
}
