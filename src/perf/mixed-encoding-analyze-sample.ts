import { decodeMixedBytes } from '../core/mixedEncoding';

const SAMPLE_B64 =
  'JS4qcwAAAAA+AAAAVy91c2VyLnV0aWxfbm90aWZ5LnBvbGwJbW9iaWxlLnN0YXR1cwk1Cee9kee7nOW3suazqOWGjCzmvKvmuLgAAH5+ITQEAAAAAABMatIIK1NPQ1NROiAlZCwlZCwlZAAAAACl////9////xkAAAB+frVSBAAAAAAATOpz';

function showText(s: string): string {
  const clipped = s.length > 80 ? s.slice(0, 80) + '…' : s;
  return clipped
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
}

function main(): void {
  const buf = Buffer.from(SAMPLE_B64, 'base64');
  const r = decodeMixedBytes(buf, { binaryStrategy: 'summary' });

  console.log(`inputBytes=${r.stats.inputBytes} asciiBytes=${r.stats.asciiBytes} utf8Bytes=${r.stats.utf8Bytes} controlBytes=${r.stats.controlBytes} invalidBytes=${r.stats.invalidBytes} binaryBytes=${r.stats.binaryBytes}`);
  console.log(`text=${showText(r.text)}`);
  console.log('segments:');
  for (const seg of r.segments) {
    const len = seg.bytes.length;
    const head = seg.bytes.subarray(0, Math.min(24, len)).toString('hex').toUpperCase();
    const tail = len > 24 ? '…' : '';
    const extra = seg.text ? ` text="${showText(seg.text)}"` : '';
    console.log(`  [${seg.start}-${seg.end}) kind=${seg.kind} len=${len} head=${head}${tail}${extra}`);
  }
}

main();

