const p = '\\\\.\\COM1';
console.log('Original:', p);
console.log('Current Regex:', p.replace(/^\\\\.\\/, ''));
console.log('Proposed Regex:', p.replace(/^\\\\\\.\\/, ''));
console.log('Alternative Regex:', p.replace(/^\\\\.\\\\/, ''));
