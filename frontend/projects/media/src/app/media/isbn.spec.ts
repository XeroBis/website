import { isbnFromBarcode } from './barcode';
import { normalizeIsbn } from './isbn';

describe('normalizeIsbn', () => {
  it('accepts ISBN-10 and ISBN-13 with hyphens or spaces', () => {
    expect(normalizeIsbn('978-1-63557-563-7')).toBe('9781635575637');
    expect(normalizeIsbn(' 1 63557 563 x ')).toBe('163557563X');
    expect(normalizeIsbn('0-8044-2957-X')).toBe('080442957X');
  });

  it('refuses a wrong length or check digit', () => {
    for (const bad of ['9781635575638', '1635575636', '12345', '97816355756370', 'abc', '']) {
      expect(normalizeIsbn(bad)).toBeNull();
    }
  });
});

describe('isbnFromBarcode', () => {
  it('reads books only (978 / 979)', () => {
    expect(isbnFromBarcode('9781635575637')).toBe('9781635575637');
    // A valid EAN-13 that isn't a book.
    expect(isbnFromBarcode('4006381333931')).toBeNull();
    expect(isbnFromBarcode('9781635575638')).toBeNull();
  });
});
