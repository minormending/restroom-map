import type { AdultChanging, Bathroom, ChangingTableAccess, WheelchairAccess } from './types'

/**
 * One registry for the nine accessibility facts: what each is called, and how
 * to say a value out loud.
 *
 * It lives here rather than in the sheet because three surfaces now need it —
 * what is settled, what somebody has claimed, and the form for answering — and
 * three copies of "what does grab_bars=true mean in English" is three chances
 * for them to drift.
 */
export const ACCESS_FIELDS = [
  'wheelchair', 'accessible_locked', 'turning_space', 'grab_bars',
  'changing_table', 'adult_changing', 'sink_in_stall', 'shelf', 'gender_neutral',
] as const
export type AccessField = (typeof ACCESS_FIELDS)[number]

export type FactState = 'yes' | 'partial' | 'no' | 'unknown'

/** The question a contributor is answering, phrased as a question. */
export const FIELD_QUESTIONS: Record<AccessField, string> = {
  wheelchair: 'Can you get in without steps?',
  accessible_locked: 'Is the accessible stall kept locked?',
  turning_space: 'Is there room to turn a wheelchair?',
  grab_bars: 'Are there grab bars?',
  changing_table: 'Is there a baby changing table?',
  adult_changing: 'Is there an adult changing bench?',
  sink_in_stall: 'Is the sink inside the cubicle?',
  shelf: 'Is there a shelf?',
  gender_neutral: 'Is there an all-gender restroom?',
}

/** The short name, for lists and for naming a gap. */
export const FIELD_NAMES: Record<AccessField, string> = {
  wheelchair: 'step-free access',
  accessible_locked: 'whether the accessible stall is locked',
  turning_space: 'room to turn a wheelchair',
  grab_bars: 'grab bars',
  changing_table: 'a changing table',
  adult_changing: 'an adult changing bench',
  sink_in_stall: 'a sink inside the cubicle',
  shelf: 'a shelf',
  gender_neutral: 'an all-gender restroom',
}

/** The answers a person can give, in the order they should be offered. */
export const FIELD_OPTIONS: Record<AccessField, { value: string; label: string }[]> = {
  wheelchair: [
    { value: 'full', label: 'Step-free' },
    { value: 'partial', label: 'Partly' },
    { value: 'none', label: 'Steps' },
  ],
  adult_changing: [
    { value: 'changing_places', label: 'Bench and hoist' },
    { value: 'bench', label: 'Bench only' },
    { value: 'none', label: 'Neither' },
  ],
  changing_table: [
    { value: 'any', label: 'Yes' },
    { value: 'women_only', label: "Women's only" },
    { value: 'men_only', label: "Men's only" },
    { value: 'none', label: 'No' },
  ],
  accessible_locked: [
    { value: 'true', label: 'Locked' },
    { value: 'false', label: 'Not locked' },
  ],
  turning_space: YES_NO(),
  grab_bars: YES_NO(),
  sink_in_stall: YES_NO(),
  shelf: YES_NO(),
  gender_neutral: YES_NO(),
}

function YES_NO() {
  return [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]
}

const STEP_FREE: Record<WheelchairAccess, [FactState, string]> = {
  full: ['yes', 'Step-free access'],
  partial: ['partial', 'Partly step-free'],
  none: ['no', 'Step-free access'],
}

const CHANGING: Record<ChangingTableAccess, [FactState, string]> = {
  any: ['yes', 'Changing table'],
  women_only: ['partial', 'Changing table — women’s room only'],
  men_only: ['partial', 'Changing table — men’s room only'],
  none: ['no', 'Changing table'],
}

const ADULT: Record<AdultChanging, [FactState, string]> = {
  changing_places: ['yes', 'Adult changing bench, with hoist'],
  bench: ['partial', 'Adult changing bench, no hoist'],
  none: ['no', 'Adult changing bench'],
}

const PLAIN_LABELS: Partial<Record<AccessField, string>> = {
  turning_space: 'Room to turn a wheelchair',
  grab_bars: 'Grab bars',
  sink_in_stall: 'Sink inside the cubicle',
  shelf: 'Shelf',
  gender_neutral: 'All-gender restroom',
}

/**
 * The answer itself — "yes", "no", "bench and hoist" — as opposed to the name
 * of the thing being answered.
 *
 * describe() returns a label that reads as a fact ("Room to turn a
 * wheelchair"), which is right when the value is settled and actively
 * misleading when it is not: rendering a claim of `false` that way states the
 * opposite of what the person said.
 */
export function answerLabel(field: AccessField, value: string): string {
  return FIELD_OPTIONS[field].find((o) => o.value === value)?.label ?? value
}

/** A stored value, said in English, with how strongly it reads. */
export function describe(field: AccessField, value: string | null | undefined): [FactState, string] {
  if (value == null) return ['unknown', FIELD_NAMES[field]]

  switch (field) {
    case 'wheelchair': return STEP_FREE[value as WheelchairAccess]
    case 'changing_table': return CHANGING[value as ChangingTableAccess]
    case 'adult_changing': return ADULT[value as AdultChanging]
    // The one field whose bad answer matters more than its good one: an
    // accessible stall you cannot get into is the journey this app exists to
    // stop somebody making.
    case 'accessible_locked': return value === 'true'
      ? ['partial', 'Accessible stall kept locked — ask staff']
      : ['yes', 'Accessible stall is not locked']
    default: return [
      value === 'true' ? 'yes' : 'no',
      PLAIN_LABELS[field] ?? FIELD_NAMES[field],
    ]
  }
}

/** What a place has settled, read off the row. */
export function settledValue(b: Bathroom, field: AccessField): string | null {
  const v = b[field as keyof Bathroom]
  if (v == null) return null
  return typeof v === 'boolean' ? String(v) : String(v)
}
