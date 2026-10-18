export function downloadBlob(blob: Blob, filename: string): void {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  window.URL.revokeObjectURL(url);
}

/** Read a JSON import in the browser before submitting it as a JSON body. */
export async function readJson(file: File): Promise<unknown> {
  return JSON.parse(await file.text());
}
