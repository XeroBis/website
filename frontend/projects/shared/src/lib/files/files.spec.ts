import { readJson } from './files';
import { httpErrorMessage } from '../http/http-error';

describe('browser import and API error helpers', () => {
  it('preserves the JSON file shape for a request body', async () => {
    const file = { text: async () => '{"decks":[{"name":"Énergie","cards":[]}]}' } as File;
    await expect(readJson(file)).resolves.toEqual({ decks: [{ name: 'Énergie', cards: [] }] });
  });
  it('rejects malformed files before they can be submitted', async () => {
    await expect(readJson({ text: async () => '{invalid' } as File)).rejects.toBeInstanceOf(
      SyntaxError,
    );
  });
  it('shows business refusals and field validation errors as readable text', () => {
    expect(
      httpErrorMessage({ status: 409, error: { detail: 'Not enough available copies' } }),
    ).toBe('Not enough available copies');
    expect(
      httpErrorMessage({
        status: 422,
        error: {
          detail: [{ loc: ['body', 'price'], msg: 'Input should be greater than or equal to 0' }],
        },
      }),
    ).toBe('body.price: Input should be greater than or equal to 0');
  });
});
