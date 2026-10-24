import { z } from 'zod';

export const QUESTION_TYPES = ['RATING', 'CHOICE', 'SHORT_TEXT', 'LONG_TEXT'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];
export const MAX_QUESTIONS = 15;

export const feedbackQuestionSchema = z
  .object({
    id: z.string().min(1).max(40),
    type: z.enum(QUESTION_TYPES),
    text: z.string().trim().min(1, 'Write the question').max(200),
    required: z.boolean(),
    options: z.array(z.string().trim().min(1).max(80)).max(10, 'At most 10 options').optional(),
  })
  .strict()
  .refine((q) => q.type !== 'CHOICE' || (q.options?.length ?? 0) >= 2, {
    message: 'Add at least two options',
    path: ['options'],
  });

export const feedbackFormSchema = z
  .object({
    questions: z
      .array(feedbackQuestionSchema)
      .min(1)
      .max(MAX_QUESTIONS, `At most ${MAX_QUESTIONS} questions`),
    confidential: z.boolean(),
    closeAt: z.iso.datetime({ offset: true }).nullish(),
  })
  .strict()
  .refine((f) => new Set(f.questions.map((q) => q.id)).size === f.questions.length, {
    message: 'Question ids must be unique',
    path: ['questions'],
  });

export type FeedbackQuestion = z.infer<typeof feedbackQuestionSchema>;

const rating = (id: string, text: string, required = false): FeedbackQuestion => ({
  id,
  type: 'RATING',
  text,
  required,
});
const long = (id: string, text: string): FeedbackQuestion => ({
  id,
  type: 'LONG_TEXT',
  text,
  required: false,
});

/** The two default forms (PRD Module H). */
export const DEFAULT_FEEDBACK: Record<
  'PARTICIPANT' | 'JUDGE',
  { confidential: boolean; questions: FeedbackQuestion[] }
> = {
  PARTICIPANT: {
    confidential: true,
    questions: [
      rating('q1', 'Overall experience', true),
      rating('q2', 'Organisation and communication'),
      rating('q3', 'Ease of using the platform', true),
      rating('q4', 'Clarity of judging criteria'),
      long('q5', 'What worked well'),
      long('q6', 'What should improve'),
      {
        id: 'q7',
        type: 'CHOICE',
        text: 'Would you participate again?',
        required: false,
        options: ['Yes', 'No', 'Maybe'],
      },
    ],
  },
  JUDGE: {
    confidential: false,
    questions: [
      rating('q1', 'Overall experience'),
      rating('q2', 'Clarity of the rubric', true),
      rating('q3', 'Ease of the evaluation workspace', true),
      {
        id: 'q4',
        type: 'CHOICE',
        text: 'Was the time sufficient?',
        required: false,
        options: ['Yes', 'No'],
      },
      long('q5', 'Suggestions'),
    ],
  },
};

/** Validates one response against the form's questions; returns field errors keyed by question id. */
export function validateFeedbackAnswers(
  questions: FeedbackQuestion[],
  answers: Record<string, unknown>,
): { clean: Record<string, string | number>; errors: Record<string, string> } {
  const clean: Record<string, string | number> = {};
  const errors: Record<string, string> = {};
  for (const q of questions) {
    const v = answers[q.id];
    const empty = v === undefined || v === null || v === '';
    if (empty) {
      if (q.required) errors[q.id] = 'This question is required';
      continue;
    }
    if (q.type === 'RATING') {
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 5)
        errors[q.id] = 'Choose a rating from 1 to 5';
      else clean[q.id] = v;
    } else if (q.type === 'CHOICE') {
      if (typeof v !== 'string' || !q.options?.includes(v))
        errors[q.id] = 'Choose one of the options';
      else clean[q.id] = v;
    } else {
      const max = q.type === 'SHORT_TEXT' ? 200 : 2000;
      if (typeof v !== 'string' || v.length > max)
        errors[q.id] = `Keep this under ${max} characters`;
      else clean[q.id] = v.trim();
    }
  }
  for (const k of Object.keys(answers))
    if (!questions.some((q) => q.id === k)) errors[k] = 'This question is not part of the form';
  return { clean, errors };
}
