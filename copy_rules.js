const fs = require('fs');
const content = fs.readFileSync('c:/Users/Daniel/Downloads/marcos-panel-code/REGLAS_INMUTABLES_MARCOS.md', 'utf8');
fs.writeFileSync('c:/Users/Daniel/Downloads/Consorcio-AI-Assistant/REGLAS_INMUTABLES_MARCOS.md', content, 'utf8');
console.log('✅ REGLAS_INMUTABLES_MARCOS.md copiado a Consorcio-AI-Assistant');
