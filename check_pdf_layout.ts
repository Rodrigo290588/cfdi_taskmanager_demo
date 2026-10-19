import fs from 'fs';
import pdfParse from 'pdf-parse';

async function check() {
  const dataBuffer = fs.readFileSync('test_output_styles.pdf');
  const data = await pdfParse(dataBuffer);
  console.log(data.text);
}
check().catch(console.error);