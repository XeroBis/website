import { matchesTemplate } from './format';
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
