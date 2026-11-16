### Frame content for ```fgb-cnes-boost.wav``` file
## 144 data bits
```111111111111111011010000110011100100000100001101001110100100100101110101001110011000000001011010000100000000111001011010000111101101101000000100```
## Hex data
```FFFED0CE410D3A497539805A100E5A1EDA04```

## Data
* Protocol: Orbitography
* Country: 227
* Hex ID: 9C821A7492EA730

## TS implementation log
npm run decode:pure -- ../samples/fgb-cnes-boost.wav --verbose --fgb-bp-hz=2500 --fgb-candidates=1 --candidates=1

> sgb-dsss-oqpsk-rx@0.73.0-fgb-cnes-boost-expected-fix decode:pure
> ts-node src/index-pure.ts ../samples/fgb-cnes-boost.wav --verbose --fgb-bp-hz=2500 --fgb-candidates=1 --candidates=1

[SGB-TS] [frontend] weak LPF bw=100000Hz taps=81 agc=25ms target=1000 ms=305.9
[fgb] carrier candidates=1
[fgb] cand#0 fft=-16054.688Hz phaseFit=-16065.688Hz score=6337.8 start=368640 postMixLpf=2500Hz
[fgb] reject phase-tracked modStart=506880 bitOffset=0.3438 inv=yes conf=16.624 preErr=0 sync=111010000 syncErrN=9 syncErrT=1 fmt=1 msgBits=144 bch1=fail:syn=0x121ede bch2=fail:syn=0xfc7 first32=11111111111111111101000011000000
[fgb] reject phase-tracked modStart=506880 bitOffset=0.3750 inv=yes conf=4.226 preErr=0 sync=111010000 syncErrN=9 syncErrT=1 fmt=1 msgBits=144 bch1=fail:syn=0x131ede bch2=fail:syn=0x32c first32=11111111111111111101000011000000
[fgb] reject phase-tracked modStart=506880 bitOffset=0.4688 inv=yes conf=2.349 preErr=0 sync=111010000 syncErrN=9 syncErrT=1 fmt=0 msgBits=112 bch1=fail:syn=0x147a94 bch2=n/a first32=11111111111111111101000001000000
[fgb] reject phase-tracked modStart=506880 bitOffset=0.5000 inv=yes conf=3.026 preErr=0 sync=111010000 syncErrN=9 syncErrT=1 fmt=0 msgBits=112 bch1=fail:syn=0x134ddc bch2=n/a first32=11111111111111111101000001000000
[fgb] reject phase-tracked modStart=506880 bitOffset=0.5313 inv=yes conf=4.191 preErr=0 sync=111010000 syncErrN=9 syncErrT=1 fmt=0 msgBits=112 bch1=fail:syn=0x690bb bch2=n/a first32=11111111111111111101000001000100
[fgb] reject phase-tracked modStart=506880 bitOffset=0.5625 inv=yes conf=1.204 preErr=0 sync=111010000 syncErrN=9 syncErrT=1 fmt=0 msgBits=112 bch1=fail:syn=0x146653 bch2=n/a first32=11111111111111111101000001000100
[fgb] reject phase-tracked modStart=529920 bitOffset=-0.6875 inv=yes conf=3.320 preErr=1 sync=011011000 syncErrN=7 syncErrT=1 fmt=1 msgBits=144 bch1=fail:syn=0xa6b58 bch2=fail:syn=0x661 first32=11111111111110101101100010011001
[fgb] reject phase-tracked modStart=529920 bitOffset=-0.6563 inv=yes conf=2.901 preErr=1 sync=011011000 syncErrN=7 syncErrT=1 fmt=0 msgBits=112 bch1=fail:syn=0x1c70ea bch2=n/a first32=11111111111110101101100000011001
[fgb] reject phase-tracked modStart=529920 bitOffset=-0.6250 inv=yes conf=8.243 preErr=1 sync=011011000 syncErrN=7 syncErrT=1 fmt=1 msgBits=144 bch1=fail:syn=0x139266 bch2=fail:syn=0xca8 first32=11111111111110101101100010011001
[fgb] reject phase-tracked modStart=576000 bitOffset=0.2188 inv=yes conf=2.088 preErr=0 sync=100101111 syncErrN=1 syncErrT=9 fmt=0 msgBits=112 bch1=fail:syn=0x1a4bf4 bch2=n/a first32=11111111111111110010111100110111
[fgb] reject phase-tracked modStart=576000 bitOffset=0.2500 inv=yes conf=2.042 preErr=1 sync=100101111 syncErrN=1 syncErrT=9 fmt=0 msgBits=112 bch1=fail:syn=0x8f787 bch2=n/a first32=11111111111110110010111100110111
[fgb] reject phase-tracked modStart=576000 bitOffset=0.2813 inv=yes conf=3.433 preErr=2 sync=100101111 syncErrN=1 syncErrT=9 fmt=0 msgBits=112 bch1=fail:syn=0x16a6ce bch2=n/a first32=11111111111100110010111100110111
[fgb] reject phase-tracked modStart=576000 bitOffset=0.3125 inv=yes conf=14.513 preErr=2 sync=100101111 syncErrN=1 syncErrT=9 fmt=0 msgBits=112 bch1=fail:syn=0x1924e8 bch2=n/a first32=11111111011110110010111100110111
[fgb] reject phase-unwrapped modStart=576000 differential=no bitOffset=0.3750 inv=yes conf=0.562 preErr=13 sync=100101111 syncErrN=1 syncErrT=9 fmt=0 msgBits=112 bch1=fail:syn=0xe8b95 bch2=n/a first32=01000001000000010010111100110111
[fgb] reject phase-unwrapped modStart=576000 differential=no bitOffset=0.4063 inv=yes conf=0.560 preErr=13 sync=100101111 syncErrN=1 syncErrT=9 fmt=0 msgBits=112 bch1=fail:syn=0xe8b95 bch2=n/a first32=01000001000000010010111100110111
[fgb] reject phase-unwrapped modStart=576000 differential=no bitOffset=0.4375 inv=yes conf=0.562 preErr=13 sync=100111111 syncErrN=2 syncErrT=8 fmt=0 msgBits=112 bch1=fail:syn=0xcd981 bch2=n/a first32=01000001000000010011111100110101
[fgb] reject phase-unwrapped modStart=576000 differential=no bitOffset=0.4688 inv=yes conf=0.578 preErr=13 sync=100111111 syncErrN=2 syncErrT=8 fmt=0 msgBits=112 bch1=fail:syn=0x9977c bch2=n/a first32=01000001000000010011111100110101
[fgb] BCH-valid phase-unwrapped 144-bit self_test carrier=-16065.688Hz modStart=576000 differential=no bitOffset=0.8750 inv=yes nerr=0+0 conf=0.740 track=-1.074
[fgb] selected carrier=-16065.688Hz start=330240 bch=0+0 conf=0.7 headers=18/15062 full=18
[SGB-TS] [fgb] BCH-valid FGB frame bits=144 sync=self_test carrier=-16065.688Hz start=330240 bch=0+0 correctedErrors=0 conf=0.7 dphi=1.15e-1 hex=FFFED0CE410D3A497539805A100E5A1EDA04
[SGB-TS] [timing] read+dc=329.4 ms fgbDetector=1905.6 ms total=2235.0 ms
SIGNAL_KIND FGB
ACQ {
  sampleRate: 1536000,
  samplesPerChip: 3840,
  mode: 'fgb',
  cfoHz: -16065.6875,
  trimSample: 330240,
  chipOffset: 0,
  boxcarOffset: 0,
  phaseDeg: 0,
  correctedErrors: 0
}
TIMING {
  readDcMs: 329.40649999999994,
  acqPrepMs: 0,
  detectorMs: 1905.5537,
  oracleMs: 0,
  totalMs: 2234.9615,
  tries: 0
}
RAW_BINARY_144 111111111111111011010000110011100100000100001101001110100100100101110101001110011000000001011010000100000000111001011010000111101101101000000100
CORRECTED_BINARY_144 111111111111111011010000110011100100000100001101001110100100100101110101001110011000000001011010000100000000111001011010000111101101101000000100
CORRECTED_HEX_144 FFFED0CE410D3A497539805A100E5A1EDA04
