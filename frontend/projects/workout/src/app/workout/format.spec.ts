import { entryNames, matchesTemplate } from './format';
import { Entry } from './models';

const exercise = (name: string) =>
  ({ id: 1, type: 'exercise', exercise_id: 1, exercise: { name }, sets: [] }) as unknown as Entry;

describe('matchesTemplate', () => {
  const template = {
    name: 'Push day',
    exercises: [
      exercise('Bench press'),
      { id: 2, type: 'circuit', name: 'Finisher', duration_minutes: null, rounds: 3, exercises: [exercise('Dips')] },
    ] as Entry[],
  };

  it('matches every word against the name, circuit names and exercise names', () => {
    expect(matchesTemplate(template, '')).toBe(true);
    expect(matchesTemplate(template, 'push')).toBe(true);
    expect(matchesTemplate(template, 'BENCH day')).toBe(true);
    expect(matchesTemplate(template, 'finisher dips')).toBe(true);
    expect(matchesTemplate(template, 'bench squat')).toBe(false);
  });
});

describe('workout summary', () => {
  const ex = (id: number, name: string, sets: object[]) =>
    ({ id, type: 'exercise', exercise_id: id, exercise: { name }, sets }) as unknown as Entry;
  const entries = [
    ex(1, 'Bench press', [{ reps: 10, weight_kg: 40 }, { reps: 8, weight_kg: 0 }, { reps: null, weight_kg: 50 }]),
    {
      id: 9,
      type: 'circuit',
      name: null,
      duration_minutes: null,
      rounds: 2,
      exercises: [ex(2, 'Dips', [{ reps: 5, weight_kg: 10 }])],
    } as Entry,
  ];

  it('names each top-level entry and flags the one holding the exercise', () => {
    expect(entryNames(entries, 2)).toEqual([
      { name: 'Bench press', hit: false },
      { name: null, hit: true },
    ]);
    expect(entryNames(entries, null).some((n) => n.hit)).toBe(false);
  });
});
