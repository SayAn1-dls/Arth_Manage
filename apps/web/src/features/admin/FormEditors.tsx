import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import {
  FILE_TYPES,
  MAX_SUBMISSION_FIELDS,
  SUBMISSION_FIELD_TYPES,
  type FormFieldDto,
} from '@arthakram/shared';
import { request } from '../../lib/api.js';
import { Alert, Button, Card, Checkbox, Input, Select, Spinner } from '../../ui/index.js';
import { useFormErrors } from '../auth/useFormErrors.js';

const TYPE_LABEL: Record<string, string> = {
  FILE: 'File upload',
  REPO_URL: 'Repository URL',
  VIDEO_URL: 'Demo video URL',
  LIVE_URL: 'Live project URL',
  OTHER_URL: 'Other link',
  SHORT_TEXT: 'Short text',
  LONG_TEXT: 'Long text',
};
type Draft = {
  id?: string;
  type: FormFieldDto['type'];
  label: string;
  helpText: string;
  required: boolean;
  allowedExtensions: string[];
  maxMb: number;
};

/** The per-round submission form (PRD B.3): up to ten configurable fields. Locked-in fields keep their data. */
export function SubmissionFormEditor({
  eventId,
  roundId,
  roundName,
}: {
  eventId: string;
  roundId: string;
  roundName: string;
}) {
  const qc = useQueryClient();
  const errors = useFormErrors();
  const q = useQuery({
    queryKey: ['round-form', eventId, roundId],
    queryFn: () =>
      request<{ fields: FormFieldDto[] }>('GET', `/events/${eventId}/rounds/${roundId}/form`),
  });
  const [fields, setFields] = useState<Draft[] | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (q.data && fields === null)
      setFields(
        q.data.fields.map((f) => ({
          id: f.id,
          type: f.type,
          label: f.label,
          helpText: f.helpText ?? '',
          required: f.required,
          allowedExtensions: f.allowedExtensions,
          maxMb: f.maxMb,
        })),
      );
  }, [q.data, fields]);
  const save = useMutation({
    mutationFn: () =>
      request('PUT', `/events/${eventId}/rounds/${roundId}/form`, {
        fields: fields!.map((f) => ({
          ...(f.id ? { id: f.id } : {}),
          type: f.type,
          label: f.label,
          helpText: f.helpText || null,
          required: f.required,
          allowedExtensions: f.type === 'FILE' ? f.allowedExtensions : [],
          maxMb: f.maxMb,
        })),
      }),
    onSuccess: async () => {
      errors.clear();
      setSaved(true);
      setFields(null);
      await qc.invalidateQueries({ queryKey: ['round-form', eventId, roundId] });
    },
    onError: errors.capture,
  });
  if (q.isPending || fields === null) return <Spinner label="Loading the form" />;
  const edit = (i: number, patch: Partial<Draft>) => {
    setSaved(false);
    setFields((fs) => fs!.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  };
  const move = (i: number, d: -1 | 1) =>
    setFields((fs) => {
      const n = [...fs!];
      const j = i + d;
      if (j < 0 || j >= n.length) return n;
      [n[i], n[j]] = [n[j]!, n[i]!];
      return n;
    });

  return (
    <Card footerLabel={`Submission form: ${roundName}`}>
      <p className="text-sm">
        Teams always provide a project title and a summary. Add up to {MAX_SUBMISSION_FIELDS} more
        fields.
      </p>
      {errors.formError && <Alert className="mt-3" tone="error" title={errors.formError} />}
      {errors.fields.fields && <Alert className="mt-3" tone="error" title={errors.fields.fields} />}
      <ul className="mt-4 flex flex-col gap-4">
        {fields.map((f, i) => (
          <li key={f.id ?? i} className="rounded-card border border-line p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="Label"
                value={f.label}
                onChange={(e) => edit(i, { label: e.target.value })}
                error={errors.fields[`fields.${i}.label`]}
              />
              <Select
                label="Type"
                value={f.type}
                disabled={Boolean(f.id)}
                onChange={(e) =>
                  edit(i, {
                    type: e.target.value as Draft['type'],
                    allowedExtensions: e.target.value === 'FILE' ? ['pdf'] : [],
                  })
                }
                hint={f.id ? 'The type of an existing field cannot change.' : undefined}
              >
                {SUBMISSION_FIELD_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABEL[t]}
                  </option>
                ))}
              </Select>
              <Input
                label="Help text"
                value={f.helpText}
                onChange={(e) => edit(i, { helpText: e.target.value })}
              />
              <Checkbox
                label="Required"
                checked={f.required}
                onChange={(e) => edit(i, { required: e.target.checked })}
              />
            </div>
            {f.type === 'FILE' && (
              <fieldset className="mt-3 flex flex-wrap items-end gap-4">
                <legend className="text-sm font-semibold text-ink">Allowed file types</legend>
                {FILE_TYPES.map((t) => (
                  <Checkbox
                    key={t}
                    label={t.toUpperCase()}
                    checked={f.allowedExtensions.includes(t)}
                    onChange={(e) =>
                      edit(i, {
                        allowedExtensions: e.target.checked
                          ? [...f.allowedExtensions, t]
                          : f.allowedExtensions.filter((x) => x !== t),
                      })
                    }
                  />
                ))}
                <div className="w-32">
                  <Input
                    type="number"
                    min={1}
                    max={50}
                    label="Max MB"
                    value={f.maxMb}
                    onChange={(e) => edit(i, { maxMb: Number(e.target.value) })}
                  />
                </div>
              </fieldset>
            )}
            <div className="mt-3 flex gap-2">
              <Button
                variant="secondary"
                aria-label="Move field up"
                icon={<ArrowUp aria-hidden className="size-4" />}
                onClick={() => move(i, -1)}
              />
              <Button
                variant="secondary"
                aria-label="Move field down"
                icon={<ArrowDown aria-hidden className="size-4" />}
                onClick={() => move(i, 1)}
              />
              <Button
                variant="ghost"
                icon={<Trash2 aria-hidden className="size-4" />}
                onClick={() => setFields((fs) => fs!.filter((_, j) => j !== i))}
              >
                Remove
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          icon={<Plus aria-hidden className="size-4" />}
          disabled={fields.length >= MAX_SUBMISSION_FIELDS}
          onClick={() =>
            setFields((fs) => [
              ...fs!,
              {
                type: 'SHORT_TEXT',
                label: '',
                helpText: '',
                required: false,
                allowedExtensions: [],
                maxMb: 25,
              },
            ])
          }
        >
          Add field
        </Button>
        <Button
          onClick={() => {
            errors.clear();
            save.mutate();
          }}
          loading={save.isPending}
        >
          Save form
        </Button>
        {saved && (
          <span role="status" className="text-sm font-semibold text-success-fg">
            Saved
          </span>
        )}
      </div>
    </Card>
  );
}

interface RegField {
  id: string;
  label: string;
  type: string;
  helpText: string | null;
  options: string[];
  required: boolean;
  hidden: boolean;
}

/** Custom registration questions (PRD FR-015): up to ten; fields with data can be hidden but not deleted. */
export function RegistrationFieldsCard({ eventId }: { eventId: string }) {
  const qc = useQueryClient();
  const errors = useFormErrors();
  const q = useQuery({
    queryKey: ['reg-fields', eventId],
    queryFn: () => request<{ fields: RegField[] }>('GET', `/events/${eventId}/registration-fields`),
  });
  const [label, setLabel] = useState('');
  const [type, setType] = useState('SHORT_TEXT');
  const [options, setOptions] = useState('');
  const [required, setRequired] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['reg-fields', eventId] });
  const add = useMutation({
    mutationFn: () =>
      request('POST', `/events/${eventId}/registration-fields`, {
        label,
        type,
        options: options
          .split('\n')
          .map((o) => o.trim())
          .filter(Boolean),
        required,
      }),
    onSuccess: async () => {
      errors.clear();
      setLabel('');
      setOptions('');
      setRequired(false);
      await refresh();
    },
    onError: errors.capture,
  });
  const toggleHidden = useMutation({
    mutationFn: (f: RegField) =>
      request('PATCH', `/events/${eventId}/registration-fields/${f.id}`, {
        label: f.label,
        type: f.type,
        helpText: f.helpText,
        options: f.options,
        required: f.required,
        hidden: !f.hidden,
      }),
    onSuccess: refresh,
    onError: errors.capture,
  });
  const remove = useMutation({
    mutationFn: (id: string) => request('DELETE', `/events/${eventId}/registration-fields/${id}`),
    onSuccess: refresh,
    onError: errors.capture,
  });

  return (
    <Card footerLabel="Registration questions">
      <h3>Custom registration questions</h3>
      <p className="mt-1 text-sm">
        Name, email, phone, institution, course, year and the name on the certificate are always
        asked. Add up to 10 more.
      </p>
      {errors.formError && <Alert className="mt-3" tone="error" title={errors.formError} />}
      <ul className="mt-3 flex flex-col gap-2">
        {q.data?.fields.map((f) => (
          <li
            key={f.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line p-3"
          >
            <span>
              <strong>{f.label}</strong> · {f.type.toLowerCase().replace('_', ' ')}
              {f.required ? ' · required' : ''}
              {f.hidden ? ' · hidden' : ''}
            </span>
            <span className="flex gap-2">
              <Button variant="secondary" onClick={() => toggleHidden.mutate(f)}>
                {f.hidden ? 'Show' : 'Hide'}
              </Button>
              <Button variant="ghost" onClick={() => remove.mutate(f.id)}>
                Delete
              </Button>
            </span>
          </li>
        ))}
        {q.data?.fields.length === 0 && <li className="text-sm">No custom questions yet.</li>}
      </ul>
      <form
        className="mt-4 grid gap-3 sm:grid-cols-2"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          errors.clear();
          add.mutate();
        }}
      >
        <Input
          label="Question"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          error={errors.fields.label}
        />
        <Select label="Answer type" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="SHORT_TEXT">Short text</option>
          <option value="LONG_TEXT">Long text</option>
          <option value="NUMBER">Number</option>
          <option value="SELECT">Single choice</option>
          <option value="URL">Link</option>
          <option value="CHECKBOX">Checkbox</option>
        </Select>
        {type === 'SELECT' && (
          <div className="sm:col-span-2">
            <label className="text-sm font-semibold text-ink" htmlFor="rf-options">
              Options, one per line
            </label>
            <textarea
              id="rf-options"
              className="mt-1.5 min-h-24 w-full rounded-pill border border-line-strong bg-white px-3 py-2"
              value={options}
              onChange={(e) => setOptions(e.target.value)}
            />
            {errors.fields.options && (
              <p className="text-sm font-semibold text-error-fg">{errors.fields.options}</p>
            )}
          </div>
        )}
        <Checkbox
          label="Required"
          checked={required}
          onChange={(e) => setRequired(e.target.checked)}
        />
        <div>
          <Button type="submit" loading={add.isPending}>
            Add question
          </Button>
        </div>
      </form>
    </Card>
  );
}
