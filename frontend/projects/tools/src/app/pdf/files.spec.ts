import { unzipSync } from 'fflate';

import { baseName, imageType, isPdf, withExtension, zip } from './files';

describe('file helpers', () => {
  it('strips the extension only', () => {
    expect(baseName('report.final.pdf')).toBe('report.final');
    expect(baseName('notes')).toBe('notes');
    expect(baseName('.hidden')).toBe('.hidden');
  });

  it('makes a safe download name with the extension', () => {
    expect(withExtension('merged.pdf', 'pdf')).toBe('merged.pdf');
    expect(withExtension('Merged.PDF', 'pdf')).toBe('Merged.PDF');
    expect(withExtension(' a/b:c ', 'pdf')).toBe('a-b-c.pdf');
    expect(withExtension('  ', 'pdf')).toBe('document.pdf');
  });

  it('recognises PDFs and images by type or name', () => {
    expect(isPdf(new File([], 'x.PDF'))).toBe(true);
    expect(isPdf(new File([], 'x', { type: 'application/pdf' }))).toBe(true);
    expect(isPdf(new File([], 'x.txt', { type: 'text/plain' }))).toBe(false);
    expect(imageType(new File([], 'a.jpeg'))).toBe('jpg');
    expect(imageType(new File([], 'a', { type: 'image/png' }))).toBe('png');
    expect(imageType(new File([], 'a.gif', { type: 'image/gif' }))).toBeNull();
  });

  it('zips files as they are', () => {
    const files = { 'a.pdf': new Uint8Array([1, 2, 3]), 'b.pdf': new Uint8Array([4]) };
    expect(unzipSync(zip(files))).toEqual(files);
  });
});
