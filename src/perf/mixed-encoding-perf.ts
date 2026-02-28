import { decodeMixedBytes } from '../core/mixedEncoding';

const SAMPLE_B64 =
  'JS4qcwAAAAA+AAAAVy91c2VyLnV0aWxfbm90aWZ5LnBvbGwJbW9iaWxlLnN0YXR1cwk1Cee9kee7nOW3suazqOWGjCzmvKvmuLgAAH5+ITQEAAAAAABMatIIK1NPQ1NROiAlZCwlZCwlZAAAAACl////9////xkAAAB+frVSBAAAAAAATOpz';

function nowNs(): bigint {
  return process.hrtime.bigint();
}

function fmtNum(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function bench(name: string, bytesPerIter: number, iters: number, fn: () => void): void {
  const t0 = nowNs();
  for (let i = 0; i < iters; i++) fn();
  const t1 = nowNs();
  const ns = Number(t1 - t0);
  const sec = ns / 1e9;
  const totalBytes = bytesPerIter * iters;
  const mb = totalBytes / (1024 * 1024);
  const mbps = mb / sec;
  const ips = iters / sec;
  console.log(`${name}`);
  console.log(`  iters=${fmtNum(iters)} time=${fmtNum(sec)}s throughput=${fmtNum(mbps)} MB/s (${fmtNum(ips)} it/s)`);
}

function main(): void {
  const sample = Buffer.from(SAMPLE_B64, 'base64');

  bench('decodeMixedBytes(sample)', sample.length, 200_000, () => {
    decodeMixedBytes(sample);
  });

  const random = Buffer.alloc(1024 * 1024);
  for (let i = 0; i < random.length; i++) random[i] = Math.floor(Math.random() * 256);

  bench('decodeMixedBytes(random1MB)', random.length, 200, () => {
    decodeMixedBytes(random);
  });
}

main();

