const s = '\\\\.\\COM6';
console.log('Target String:', s);

const re4 = /^\\\\.\\/;
console.log('Regex 4 slashes:', re4);
console.log('Match 4:', re4.test(s));
console.log('Replace 4:', s.replace(re4, ''));

const re6 = /^\\\\\\.\\/;
console.log('Regex 6 slashes:', re6);
console.log('Match 6:', re6.test(s));
console.log('Replace 6:', s.replace(re6, ''));
