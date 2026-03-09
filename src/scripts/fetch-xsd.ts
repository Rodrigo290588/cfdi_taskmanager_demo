import fs from 'fs';
import path from 'path';

async function main() {
  const url = 'https://cfdidescargamasivasolicitud.clouda.sat.gob.mx/SolicitaDescargaService.svc?xsd=xsd0';
  const outputPath = path.resolve(process.cwd(), 'solicita_descarga.xsd');

  console.log(`Fetching XSD from ${url}...`);

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch XSD: ${response.status} ${response.statusText}`);
    }

    const xsdContent = await response.text();
    fs.writeFileSync(outputPath, xsdContent);
    console.log(`XSD saved to ${outputPath}`);
    
    // Print the first 500 chars to verify
    console.log('--- XSD Preview ---');
    console.log(xsdContent.substring(0, 500));
  } catch (error) {
    console.error('Error fetching XSD:', error);
  }
}

main();
