const fs = require('fs');
const content = fs.readFileSync('c:/Users/Daniel/Downloads/marcos-panel-code/index.js', 'utf8');
fs.writeFileSync('c:/Users/Daniel/Downloads/Consorcio-AI-Assistant/index.js', content, 'utf8');
console.log('✅ index.js copiado a Consorcio-AI-Assistant');
