import type { RubricCriterionInput } from './engine.js';

export interface RubricTemplateCriterion extends RubricCriterionInput {
  description: string;
}

export interface RubricTemplate {
  key: 'HACKATHON' | 'CASE_COMPETITION';
  name: string;
  criteria: RubricTemplateCriterion[];
}

/** System-provided generic rubrics (PRD FR-141). Copied into a round; editing the copy never changes these. */
export const RUBRIC_TEMPLATES: RubricTemplate[] = [
  {
    key: 'HACKATHON',
    name: 'Hackathon default',
    criteria: [
      {
        name: 'Problem understanding and relevance',
        weight: 20,
        min: 1,
        max: 10,
        description: 'How clearly the team frames a real problem and why it matters.',
      },
      {
        name: 'Innovation and originality',
        weight: 20,
        min: 1,
        max: 10,
        description: 'How fresh the approach is compared with obvious solutions.',
      },
      {
        name: 'Technical execution',
        weight: 25,
        min: 1,
        max: 10,
        description: 'How well the solution is built and how robust it is.',
      },
      {
        name: 'Impact and feasibility',
        weight: 20,
        min: 1,
        max: 10,
        description: 'Whether the idea could work and matter beyond the event.',
      },
      {
        name: 'Presentation and demo',
        weight: 15,
        min: 1,
        max: 10,
        description: 'How clearly the team communicates and shows its work.',
      },
    ],
  },
  {
    key: 'CASE_COMPETITION',
    name: 'Case competition default',
    criteria: [
      {
        name: 'Problem analysis',
        weight: 25,
        min: 1,
        max: 10,
        description: 'Depth and accuracy of the diagnosis of the case.',
      },
      {
        name: 'Quality of recommendations',
        weight: 25,
        min: 1,
        max: 10,
        description: 'How sound, specific and well-argued the recommendations are.',
      },
      {
        name: 'Feasibility and implementation',
        weight: 20,
        min: 1,
        max: 10,
        description: 'How realistic the plan is, including risks and next steps.',
      },
      {
        name: 'Quantitative and financial rigour',
        weight: 15,
        min: 1,
        max: 10,
        description: 'How well numbers support the argument.',
      },
      {
        name: 'Presentation and communication',
        weight: 15,
        min: 1,
        max: 10,
        description: 'Structure, clarity and persuasiveness of the delivery.',
      },
    ],
  },
];
