### Frame content for ```fgb.wav``` file
## 144 data bits
```111111111111111011010000100011100011001000000000000000000000000000101011100000000010110010001100000001010011011010011000111011000111111110010111```
## Hex data
```FFFED08E320000002B802C8C053698EC7F97```

## Data
* Protocol: 2 (Standard Location)
* Country: 227
* Hex ID: 1C64000000FFBFF
* Identification: MMSI: 000000000, Beacon: 0
* Test Protocol: Active
* Position (PDF-1): 43.60333 N, 1.45778 E

## TS implementation log
npm run decode:pure -- ../samples/fgb.wav --verbose --fgb-bp-hz=2500 --fgb-candidates=1 --candidates=1           

> sgb-dsss-oqpsk-rx@0.73.0-fgb-cnes-boost-expected-fix decode:pure
> ts-node src/index-pure.ts ../samples/fgb.wav --verbose --fgb-bp-hz=2500 --fgb-candidates=1 --candidates=1

[SGB-TS] [frontend] weak LPF bw=100000Hz taps=81 agc=25ms target=1000 ms=392.6
[fgb] carrier candidates=1
[fgb] cand#0 fft=0.000Hz phaseFit=8.765Hz score=36756.2 start=675840 postMixLpf=2500Hz
[fgb] reject phase-tracked modStart=798720 bitOffset=0.5313 inv=yes conf=6.298 preErr=0 sync=011010010 syncErrN=7 syncErrT=1 fmt=1 msgBits=144 bch1=fail:syn=0xe8871 bch2=ok2 first32=11111111111111101101001011110111
[fgb] reject phase-tracked modStart=806400 bitOffset=-0.2500 inv=yes conf=2.239 preErr=2 sync=010101111 syncErrN=1 syncErrT=7 fmt=1 msgBits=144 bch1=fail:syn=0x1d242b bch2=ok2 first32=11111111111010101010111111111111
[fgb] reject phase-tracked modStart=814080 bitOffset=0.5313 inv=yes conf=6.168 preErr=0 sync=100101111 syncErrN=1 syncErrT=9 fmt=0 msgBits=112 bch1=fail:syn=0x44755 bch2=n/a first32=11111111111111110010111101110101
[fgb] reject phase-tracked modStart=814080 bitOffset=0.8125 inv=yes conf=1.330 preErr=1 sync=100101111 syncErrN=1 syncErrT=9 fmt=0 msgBits=112 bch1=fail:syn=0x1eed42 bch2=n/a first32=11111111111110110010111101110001
[fgb] reject phase-unwrapped modStart=814080 differential=no bitOffset=0.5625 inv=yes conf=0.585 preErr=6 sync=101101111 syncErrN=2 syncErrT=8 fmt=0 msgBits=112 bch1=fail:syn=0xa7a56 bch2=n/a first32=11101010110010110110111101110001
[fgb] reject phase-unwrapped modStart=814080 differential=no bitOffset=0.5938 inv=yes conf=0.574 preErr=10 sync=101101111 syncErrN=2 syncErrT=8 fmt=0 msgBits=112 bch1=fail:syn=0x42a88 bch2=n/a first32=00000010110010110110111101110111
[fgb] reject phase-unwrapped modStart=814080 differential=no bitOffset=0.6250 inv=yes conf=0.537 preErr=13 sync=101101111 syncErrN=2 syncErrT=8 fmt=0 msgBits=112 bch1=fail:syn=0xd62d8 bch2=n/a first32=00000000001001010110111101111111
[fgb] reject phase-unwrapped modStart=814080 differential=no bitOffset=0.6563 inv=yes conf=0.528 preErr=14 sync=101101111 syncErrN=2 syncErrT=8 fmt=0 msgBits=112 bch1=fail:syn=0x179d70 bch2=n/a first32=00000000000001010110111101111111
[fgb] reject phase-unwrapped modStart=814080 differential=no bitOffset=0.6875 inv=yes conf=0.527 preErr=14 sync=101101111 syncErrN=2 syncErrT=8 fmt=1 msgBits=144 bch1=fail:syn=0x28054 bch2=ok2 first32=00000000000000110110111111111111
[fgb] reject phase-unwrapped modStart=814080 differential=no bitOffset=0.7188 inv=yes conf=0.544 preErr=14 sync=101101111 syncErrN=2 syncErrT=8 fmt=1 msgBits=144 bch1=fail:syn=0x187ffc bch2=ok2 first32=00000000000001010110111111111111
[fgb] reject phase-unwrapped modStart=814080 differential=no bitOffset=0.7500 inv=yes conf=0.573 preErr=12 sync=101111111 syncErrN=3 syncErrT=7 fmt=1 msgBits=144 bch1=fail:syn=0x28054 bch2=ok2 first32=00000000010010110111111111111111
[fgb] reject phase-unwrapped modStart=814080 differential=no bitOffset=0.7813 inv=yes conf=0.617 preErr=8 sync=110111111 syncErrN=3 syncErrT=7 fmt=1 msgBits=144 bch1=fail:syn=0x7c323 bch2=ok2 first32=01100101011001011011111111111111
[fgb] BCH-valid legacy 144-bit self_test carrier=8.765Hz modStart=814080 bitOffset=0.2188 axis=real inv=no nerr=0+0 conf=5278.8 dphi=6.55e-3
[fgb] selected carrier=8.765Hz start=568320 bch=0+0 conf=5278.8 headers=13/3797 full=13
[SGB-TS] [fgb] BCH-valid FGB frame bits=144 sync=self_test carrier=8.765Hz start=568320 bch=0+0 correctedErrors=0 conf=5278.8 dphi=6.55e-3 hex=FFFED08E320000002B802C8C053698EC7F97
[SGB-TS] [timing] read+dc=421.3 ms fgbDetector=1921.5 ms total=2342.8 ms
SIGNAL_KIND FGB
ACQ {
  sampleRate: 1536000,
  samplesPerChip: 3840,
  mode: 'fgb',
  cfoHz: 8.765205344609958,
  trimSample: 568320,
  chipOffset: 0,
  boxcarOffset: 0,
  phaseDeg: 0,
  correctedErrors: 0
}
TIMING {
  readDcMs: 421.2781,
  acqPrepMs: 0,
  detectorMs: 1921.55,
  oracleMs: 0,
  totalMs: 2342.8293,
  tries: 0
}
RAW_BINARY_144 111111111111111011010000100011100011001000000000000000000000000000101011100000000010110010001100000001010011011010011000111011000111111110010111
CORRECTED_BINARY_144 111111111111111011010000100011100011001000000000000000000000000000101011100000000010110010001100000001010011011010011000111011000111111110010111
CORRECTED_HEX_144 FFFED08E320000002B802C8C053698EC7F97