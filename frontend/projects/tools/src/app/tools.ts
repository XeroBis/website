import { IconName } from '@shared';

/** The tools, in display order: route, icon, and i18n key under `tool.`. */
export const TOOLS: readonly { path: string; icon: IconName; key: string }[] = [
  { path: '/merge', icon: 'merge', key: 'merge' },
  { path: '/extract', icon: 'scissors', key: 'extract' },
  { path: '/organize', icon: 'grid', key: 'organize' },
  { path: '/images-to-pdf', icon: 'image', key: 'imagesToPdf' },
  { path: '/pdf-to-images', icon: 'file-image', key: 'pdfToImages' },
  { path: '/sign', icon: 'signature', key: 'sign' },
];
