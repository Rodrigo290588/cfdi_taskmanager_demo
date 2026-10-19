import { generateTemplateNominaHtml } from './src/components/pdf-templates/TemplateNomina';
import fs from 'fs';

const html = generateTemplateNominaHtml({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cfdiData: {} as any,
  qrCodeDataUrl: '',
  isCancelled: false
});

fs.writeFileSync('test.html', html);
