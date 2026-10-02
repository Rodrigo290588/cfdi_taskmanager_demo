// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs');
const lines = fs.readFileSync('src/app/dashboard_fiscal/page.tsx', 'utf8').split('\n');

lines.forEach((line, i) => {
  if (line.includes('value=')) {
    console.log(i + 1, line.trim());
  }
});
