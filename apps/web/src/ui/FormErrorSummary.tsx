import { useEffect, useRef } from 'react';
import { OctagonAlert } from 'lucide-react';

export interface FormIssue {
  /** DOM id of the offending field, so the summary can link to it. */
  fieldId?: string;
  message: string;
}

/** Summarises validation errors at the top of a form and moves focus to it (PRD 6.0-4, §11.5). */
export function FormErrorSummary({
  issues,
  title = 'Please fix the following',
}: {
  issues: FormIssue[];
  title?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (issues.length) ref.current?.focus();
  }, [issues]);
  if (!issues.length) return null;
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="alert"
      className="rounded-card border-l-4 border-error-fg bg-error-bg p-4 text-error-fg"
    >
      <p className="flex items-center gap-2 font-bold">
        <OctagonAlert aria-hidden className="size-5" />
        {title}
      </p>
      <ul className="mt-2 list-disc pl-6 text-sm">
        {issues.map((i, n) => (
          <li key={`${i.fieldId ?? 'form'}-${n}`}>
            {i.fieldId ? (
              <a href={`#${i.fieldId}`} className="text-error-fg">
                {i.message}
              </a>
            ) : (
              i.message
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
