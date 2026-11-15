// pdf.js's worker, bundled by the Angular build as its own hashed .js file
// (see PdfRenderer). Copying pdf.js's .mjs as an asset wouldn't work in prod:
// the edge's nginx serves .mjs without a JavaScript MIME type.
import 'pdfjs-dist/build/pdf.worker.min.mjs';
