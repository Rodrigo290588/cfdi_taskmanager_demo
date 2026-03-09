import fs from 'fs';
import path from 'path';

const xsdPath = path.resolve(process.cwd(), 'solicita_descarga.xsd');
const xsdContent = fs.readFileSync(xsdPath, 'utf-8');

// Simple pretty print
const formatted = xsdContent.replace(/>\s*</g, '>\n<');
console.log(formatted);
