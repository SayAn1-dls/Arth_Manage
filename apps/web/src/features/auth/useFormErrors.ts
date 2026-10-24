import { useState } from 'react';
import type { FormIssue } from '../../ui/index.js';
import { ApiError } from '../../lib/api.js';

/** Maps an ApiError onto per-field messages plus a summary list, keyed by the DOM id of each field. */
export function useFormErrors() {
  const [fields, setFields] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);

  return {
    fields,
    formError,
    code,
    clear() {
      setFields({});
      setFormError(null);
      setCode(null);
    },
    capture(e: unknown) {
      if (e instanceof ApiError) {
        setCode(e.code);
        if (Object.keys(e.fields).length) {
          setFields(e.fields);
          setFormError(null);
        } else {
          setFormError(e.message);
        }
      } else {
        setFormError('Something went wrong. Check your connection and try again.');
      }
    },
    issues(ids: Record<string, string>): FormIssue[] {
      const list: FormIssue[] = Object.entries(fields).map(([name, message]) => ({
        fieldId: ids[name],
        message,
      }));
      return list;
    },
  };
}
