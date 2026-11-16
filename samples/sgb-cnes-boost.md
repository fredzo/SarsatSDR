### Frame content for ```sgb-cnes-boost.wav``` file
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
npm run decode:pure -- ../samples/sgb-cnes-boost.wav --verbose --fgb-bp-hz=2500 --fgb-candidates=1 --candidates=1

> sgb-dsss-oqpsk-rx@0.73.0-fgb-cnes-boost-expected-fix decode:pure
> ts-node src/index-pure.ts ../samples/sgb-cnes-boost.wav --verbose --fgb-bp-hz=2500 --fgb-candidates=1 --candidates=1

[SGB-TS] [frontend] weak LPF bw=100000Hz taps=81 agc=25ms target=1000 ms=588.5
[fgb] carrier candidates=1
[fgb] cand#0 fft=2015.625Hz phaseFit=419.971Hz score=543.5 start=3440640 postMixLpf=2500Hz
[fgb] no frame after headers=1/42900 full=0 exactSyncHeaders=0 rejectsLogged=0 bitGrid=1/32 startStepMs=5
[SGB-TS] [fgb] no BCH-valid FGB frame, continuing with SGB PRN acquisition
[SGB-TS] [rt-fft512] start cfoCenter=0.000Hz depth=1200 bins=19 hop=50 patch=512
[SGB-TS] [rt-fft512] bank workers=4 workerMs=2170.0 forwardFFTs=38988 reverseFFTs=155952 directScores=310491 patch=512 coarseHop=200 refineRadius=100 modes=2 cfoBins=19 kept=64
[SGB-TS] try#1 mode=normal trim=1406960 cfo=933.3 boxcar=0 off=0 phase=0 detLevel=287.9
[SGB-TS] try#2 mode=normal trim=1406960 cfo=933.3 boxcar=0 off=0 phase=90 detLevel=287.9
[SGB-TS] try#3 mode=normal trim=1406960 cfo=933.3 boxcar=0 off=0 phase=180 detLevel=287.9
[SGB-TS] try#4 mode=normal trim=1406960 cfo=933.3 boxcar=0 off=0 phase=270 detLevel=287.9
[SGB-TS] try#5 mode=normal trim=1406960 cfo=933.3 boxcar=0 off=1 phase=0 detLevel=287.9
[SGB-TS] try#6 mode=normal trim=1406960 cfo=933.3 boxcar=0 off=1 phase=90 detLevel=287.9
[SGB-TS] try#7 mode=normal trim=1406960 cfo=933.3 boxcar=0 off=1 phase=180 detLevel=287.9
[SGB-TS] try#8 mode=normal trim=1406960 cfo=933.3 boxcar=0 off=1 phase=270 detLevel=287.9
[SGB-TS] try#9 mode=normal trim=1406960 cfo=933.3 boxcar=10 off=0 phase=0 detLevel=263.7
[SGB-TS] BCH-valid candidate after 9 despread attempts; nerr=2
[SGB-TS] [timing] read+dc=669.2 ms acqPrep=7.8 ms detector=2172.8 ms oracle=1315.8 ms total=4568.8 ms tries=9
SIGNAL_KIND SGB
ACQ {
  sampleRate: 1536000,
  samplesPerChip: 40,
  mode: 'normal',
  cfoHz: 924.2733171862836,
  trimSample: 1406960,
  chipOffset: 0,
  boxcarOffset: 10,
  phaseDeg: -121.38529403664975,
  correctedErrors: 2,
  qSense: 1
}
TIMING {
  readDcMs: 669.2388000000001,
  acqPrepMs: 7.824200000000019,
  detectorMs: 2172.83,
  oracleMs: 1315.8174,
  totalMs: 4568.8045999999995,
  tries: 9
}
RAW_BINARY_250 0011111111111111100001101001110011100011001001010111000111101111100000000010111101100010111110000000000000000000000000000000000000000000011111111111111111000011111111111111110111111111111111111011110000010001110000010000000000101001000100100011111101
CORRECTED_BINARY_250 1111111111111111100001101001110011100011001001010111000111101111100000000010111101100010111110000000000000000000000000000000000000000000011111111111111111000011111111111111110111111111111111111011110000010001110000010000000000101001000100100011111101
CORRECTED_HEX_250 3FFFE1A738C95C7BE00BD8BE00000000001FFFF0FFFF7FFFEF0470400A448FD