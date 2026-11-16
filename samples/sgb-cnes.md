### Frame content for ```sgb-cnes.wav``` file
## 250 data bits
```1111111111111111100001101001110011100011001001010111000111101111100000000010111101100010111110000000000000000000000000000000000000000000011111111111111111000011111111111111110111111111111111111011110000010001110000010000000000101001000100100011111101```
## Hex data (63 hex char as per COSPAS/SARSAT specifictaion)
```3FFFE1A738C95C7BE00BD8BE00000000001FFFF0FFFF7FFFEF0470400A448FD```

## IDENTIFICATION


## STATUS


## ENCODED GNSS LOCATION


## ROTATING FIELD 0


## Reference implementation log
```
```

## TS implementation log
npm run decode:pure -- ../samples/sgb-cnes.wav --verbose --fgb-bp-hz=2500 --fgb-candidates=1 --candidates=1

> sgb-dsss-oqpsk-rx@0.73.0-fgb-cnes-boost-expected-fix decode:pure
> ts-node src/index-pure.ts ../samples/sgb-cnes.wav --verbose --fgb-bp-hz=2500 --fgb-candidates=1 --candidates=1

[SGB-TS] [frontend] weak LPF bw=100000Hz taps=81 agc=25ms target=1000 ms=571.5
[fgb] carrier candidates=1
[fgb] cand#0 fft=2039.063Hz phaseFit=2546.773Hz score=714.3 start=983040 postMixLpf=2500Hz
[fgb] reject phase-unwrapped modStart=1336320 differential=yes bitOffset=-0.0313 inv=no conf=0.652 preErr=3 sync=010101000 syncErrN=4 syncErrT=4 fmt=1 msgBits=144 bch1=fail:syn=0xb1fdc bch2=fail:syn=0x72d first32=10111111111001101010100010110011
[fgb] no frame after headers=1/42900 full=1 exactSyncHeaders=0 rejectsLogged=1 bitGrid=1/32 startStepMs=5
[SGB-TS] [fgb] no BCH-valid FGB frame, continuing with SGB PRN acquisition
[SGB-TS] [rt-fft512] start cfoCenter=0.000Hz depth=1200 bins=19 hop=50 patch=512
[SGB-TS] [rt-fft512] bank workers=4 workerMs=2095.1 forwardFFTs=36784 reverseFFTs=147136 directScores=310604 patch=512 coarseHop=200 refineRadius=100 modes=2 cfoBins=19 kept=64
[SGB-TS] try#1 mode=normal trim=1457520 cfo=933.3 boxcar=10 off=0 phase=0 detLevel=485.8
[SGB-TS] BCH-valid candidate after 1 despread attempts; nerr=1
[SGB-TS] [timing] read+dc=646.8 ms acqPrep=9.9 ms detector=2097.4 ms oracle=32.7 ms total=4858.2 ms tries=1
SIGNAL_KIND SGB
ACQ {
  sampleRate: 1536000,
  samplesPerChip: 40,
  mode: 'normal',
  cfoHz: 927.4258897645012,
  trimSample: 1457520,
  chipOffset: 0,
  boxcarOffset: 10,
  phaseDeg: -88.24143782766363,
  correctedErrors: 1,
  qSense: 1
}
TIMING {
  readDcMs: 646.8255999999999,
  acqPrepMs: 9.915999999999713,
  detectorMs: 2097.3552,
  oracleMs: 32.65729999999985,
  totalMs: 4858.1752,
  tries: 1
}
RAW_BINARY_250 1011111111111111100001101001110011100011001001010111000111101111100000000010111101100010111110000000000000000000000000000000000000000000011111111111111111000011111111111111110111111111111111111011110000010001110000010000000000101001000100100011111101
CORRECTED_BINARY_250 1111111111111111100001101001110011100011001001010111000111101111100000000010111101100010111110000000000000000000000000000000000000000000011111111111111111000011111111111111110111111111111111111011110000010001110000010000000000101001000100100011111101
CORRECTED_HEX_250 3FFFE1A738C95C7BE00BD8BE00000000001FFFF0FFFF7FFFEF0470400A448FD
