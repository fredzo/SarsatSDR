### Frame content for ```sgb-self-test.wav``` file
## 250 data bits
```0000000011100110000010001111010011100011001001010111001101010101010000000010111010101010110000000000000000000000000000000000000000000000000111111111111111000000000000000000000111111111100000000001011000000100101001101100110000110000011110001100101010```
## Hex data (63 hex char as per COSPAS/SARSAT specifictaion, first bit of first nibble set to one for self-test mode)
```8039823D38C95CD5500BAAB0000000000007FFF000007FE0058129B30C1E32A```

## IDENTIFICATION
Frame Mode: Self-test
23 Hex ID: 9C74039823D800000000000
TAC Number: 230 (0x00E6)
Serial Number: 573 (0x023D)
Country Code: 227 (France)
Type: EPIRB
Vessel ID: None

## STATUS
Homing Device: Not Available/Disabled
RLS Capability: Disabled
Test Protocol: Active (Non-operational)

## ENCODED GNSS LOCATION
Position: 43.60416°N, 1.45834°E
Coordinates: 43.60416°N, 1.45834°E
Resolution: ~3.4 meters maximum

## ROTATING FIELD 0
Type: G.008 Objective Requirements
Elapsed time: 0 hours
Last position: 0 minutes ago
Altitude: Not available
HDOP: DOP ≤1
VDOP: DOP ≤1
Battery: >75% and <=100% remaining
GNSS Status: 3D location

## Reference implementation log
```
 ./build/dec406_iq ./406/sgb-self-test.wav -s 1536000 -i
Rate: 1536000 Hz  SPS: 40.000
File: 13.2 MB, 3298571 samples (2.1 s)
Scan t=0.00s...[main_iq] burst at blk 53 (520.000 ms), trimming 798720 samples  P10=1.9e-04 P90=1.3e-01
<7>[dsss_demod] buffer too short (1274880 < 1536000 samples)
Scan t=0.25s...[main_iq] burst at blk 28 (270.000 ms), trimming 414720 samples  P10=1.9e-04 P90=1.3e-01
<7>[freq_acq] fft-corr NORMAL PRN: coarse reject conf 2.5 (need >=5)  offset 4 Hz  lag 5652/8063 (n_chips 12000 remain 6348)  peak 9.79e+14  median 3.87e+14  mean 3.99e+14  phase 1
<7>[freq_acq] fft-corr SELF-TEST PRN: offset 10 Hz  conf 66.1  lag 508/8063 (n_chips 12000 remain 11492)  peak 2.55e+16  median 3.86e+14  mean 4.39e+14  phase 1
<7>[freq_acq] fft-corr selected SELF-TEST PRN (conf 66.1)
<7>[dsss_demod] acquisition accepted in +/-8000 Hz window
<7>[dsss_demod] selected SGB PRN SELF-TEST
<7>[despread] Synced (SELF-TEST PRN): off_I=507 (z=14.9), off_Q=507 (z=208.9), combined=209.5, phase=180°, z1/z2=14.9/4.0=3.70 lag2=2156
<7>[despread] Synced (SELF-TEST PRN): off_I=507 (z=17.9), off_Q=507 (z=252.3), combined=252.9, phase=180°, z1/z2=17.9/5.0=3.57 lag2=1579
<7>[despread] Synced (SELF-TEST PRN): off_I=507 (z=17.1), off_Q=507 (z=246.3), combined=246.9, phase=180°, z1/z2=17.1/4.5=3.81 lag2=1841
<7>[despread] Synced (SELF-TEST PRN): off_I=507 (z=47.1), off_Q=507 (z=1532.4), combined=1533.1, phase=0°, z1/z2=47.1/2.0=23.09 lag2=2508
<7>[despread] Synced (SELF-TEST PRN): off_I=507 (z=21.8), off_Q=507 (z=306.4), combined=307.2, phase=270°, z1/z2=21.8/4.0=5.49 lag2=30
<7>[despread] Synced (SELF-TEST PRN): off_I=507 (z=18.4), off_Q=507 (z=265.7), combined=266.3, phase=270°, z1/z2=18.4/3.7=4.93 lag2=136
<7>[despread] Synced (SELF-TEST PRN): off_I=507 (z=14.3), off_Q=507 (z=205.2), combined=205.7, phase=270°, z1/z2=14.3/4.0=3.54 lag2=2282
<7>[despread] Synced (SELF-TEST PRN): off_I=507 (z=47.1), off_Q=507 (z=1532.4), combined=1533.1, phase=0°, z1/z2=47.1/2.0=23.09 lag2=2508
<7>[despread] preamble fit: intercept=-2.353 slope=0.0053 rad/bit (0.13 Hz) phase_rad=-2.222
<7>[dsss_demod] offset 0/40 phase 0° z=1533 nerr=0
<7>[dsss_demod] BCH validated: boxcar offset 0/40 Costas phase 0° nerr=0
<7>[dsss_demod] bits250=00E608F4E3257355402EAAC000000000001FFFC00001FF801604A6CC3078CA8
  Sync at t=0.52s (z=1533.1)
Scan t=0.50s...[main_iq] burst at blk 3 (20.000 ms), trimming 30720 samples  P10=1.9e-04 P90=1.3e-01
<7>[freq_acq] fft-corr NORMAL PRN: coarse reject conf 2.5 (need >=5)  offset 4 Hz  lag 5652/8063 (n_chips 12000 remain 6348)  peak 9.79e+14  median 3.87e+14  mean 3.99e+14  phase 1
<7>[freq_acq] fft-corr SELF-TEST PRN: offset 10 Hz  conf 66.1  lag 508/8063 (n_chips 12000 remain 11492)  peak 2.55e+16  median 3.86e+14  mean 4.39e+14  phase 1
<7>[freq_acq] fft-corr selected SELF-TEST PRN (conf 66.1)
<7>[dsss_demod] acquisition accepted in +/-8000 Hz window
<7>[dsss_demod] selected SGB PRN SELF-TEST
<7>[despread] Synced (SELF-TEST PRN): off_I=507 (z=15.3), off_Q=507 (z=208.9), combined=209.5, phase=180°, z1/z2=15.3/4.8=3.18 lag2=6192
<7>[despread] Synced (SELF-TEST PRN): off_I=507 (z=18.6), off_Q=507 (z=252.3), combined=253.0, phase=180°, z1/z2=18.6/5.3=3.50 lag2=3714
<7>[despread] Synced (SELF-TEST PRN): off_I=507 (z=18.0), off_Q=507 (z=246.3), combined=247.0, phase=180°, z1/z2=18.0/4.7=3.79 lag2=1841
<7>[despread] Synced (SELF-TEST PRN): off_I=507 (z=73.0), off_Q=507 (z=1532.4), combined=1534.1, phase=0°, z1/z2=73.0/3.2=22.74 lag2=3403
<7>[despread] Synced (SELF-TEST PRN): off_I=507 (z=23.0), off_Q=507 (z=306.4), combined=307.3, phase=270°, z1/z2=23.0/4.6=5.05 lag2=8344
<7>[despread] Synced (SELF-TEST PRN): off_I=507 (z=19.3), off_Q=507 (z=265.7), combined=266.4, phase=270°, z1/z2=19.3/5.0=3.87 lag2=8757
<7>[despread] Synced (SELF-TEST PRN): off_I=507 (z=14.8), off_Q=507 (z=205.2), combined=205.7, phase=270°, z1/z2=14.8/4.5=3.28 lag2=9243
<7>[despread] Synced (SELF-TEST PRN): off_I=507 (z=73.0), off_Q=507 (z=1532.4), combined=1534.1, phase=0°, z1/z2=73.0/3.2=22.74 lag2=3403
<7>[despread] preamble fit: intercept=-2.353 slope=0.0053 rad/bit (0.13 Hz) phase_rad=-2.222
<7>[dsss_demod] offset 0/40 phase 0° z=1534 nerr=0
<7>[dsss_demod] BCH validated: boxcar offset 0/40 Costas phase 0° nerr=0
<7>[dsss_demod] bits250=00E608F4E3257355402EAAC000000000001FFFC00001FF801604A6CC3078CA8
  Sync at t=0.52s (z=1534.1)
Scan t=0.75s...[main_iq] burst at blk 0 (0.000 ms), trimming 0 samples  P10=1.9e-04 P90=1.2e-01
<7>[freq_acq] fft-corr NORMAL PRN: coarse reject conf 4.9 (need >=5)  offset 4 Hz  lag 5924/8063 (n_chips 12000 remain 6076)  peak 1.67e+15  median 3.44e+14  mean 3.55e+14  phase 0
<7>[freq_acq] fft-corr SELF-TEST PRN: coarse reject conf 3.7 (need >=5)  offset 16 Hz  lag 5535/8063 (n_chips 12000 remain 6465)  peak 1.29e+15  median 3.51e+14  mean 3.62e+14  phase 1
<7>[freq_acq] fft-corr selected NORMAL PRN (conf 4.9)
<7>[dsss_demod] acquisition widening to +/-16000 Hz (first freq=4 Hz conf=4.9, prn=NORMAL, need >=8.0)
<7>[freq_acq] fft-corr NORMAL PRN: coarse reject conf 4.9 (need >=5)  offset 8 Hz  lag 5924/8063 (n_chips 12000 remain 6076)  peak 1.71e+15  median 3.46e+14  mean 3.57e+14  phase 0
<7>[freq_acq] fft-corr SELF-TEST PRN: coarse reject conf 3.9 (need >=5)  offset 8 Hz  lag 5535/8063 (n_chips 12000 remain 6465)  peak 1.37e+15  median 3.49e+14  mean 3.59e+14  phase 1
<7>[freq_acq] fft-corr selected NORMAL PRN (conf 4.9)
<7>[dsss_demod] acquisition rejected (freq=8 Hz conf=4.9, prn=NORMAL, need >=8.0)

2 windows synced — decoding best (z=1534.1)

=== Demodulated bits (hex, 63 chars) ===
0039823D38C95CD5500BAAB0000000000007FFF000007FE0058129B30C1E32A

=== FRAME DECODING ===
Starting 2G decoding...

=== 406 MHz SECOND GENERATION BEACON (SGB) ===
[IDENTIFICATION]
 Frame Mode: Self-test
 23 Hex ID: 9C74039823D800000000000
 Corrected 250 bits: 8039823D38C95CD5500BAAB0000000000007FFF000007FE0058129B30C1E32A
 TAC Number: 230 (0x00E6)
 Serial Number: 573 (0x023D)
 Country Code: 227 (France)
 Type: EPIRB
 Vessel ID: None

[STATUS]
 Homing Device: Not Available/Disabled
 RLS Capability: Disabled
 Test Protocol: Active (Non-operational)

[ENCODED GNSS LOCATION]
 Position: 43.60416°N, 1.45834°E
 Coordinates: 43.60416°N, 1.45834°E
 Resolution: ~3.4 meters maximum
https://www.openstreetmap.org/?mlat=43.60416&mlon=1.45834#map=18/43.60416/1.45834


[ROTATING FIELD 0]
 Type: G.008 Objective Requirements
 Elapsed time: 0 hours
 Last position: 0 minutes ago
 Altitude: Not available
 HDOP: DOP ≤1
 VDOP: DOP ≤1
 Battery: >75% and <=100% remaining
 GNSS Status: 3D location

[COMPLIANCE]
 Standard: COSPAS-SARSAT T.018 Second Generation Beacon
 BCH Error Correction: BCH(250,202) - 48 bits
 Data Rate: 300 bps, Spread Spectrum: DSSS-OQPSK
====================================================

╔════════════════════════════════════════════════════════════════╗
║                    DEMODULATION COMPLETE                      ║
╚════════════════════════════════════════════════════════════════╝
```

## TS implementation log
npm run decode:pure -- ../samples/sgb-self-test.wav --verbose --fgb-bp-hz=2500 --fgb-candidates=1 --candidates=1 

> sgb-dsss-oqpsk-rx@0.73.0-fgb-cnes-boost-expected-fix decode:pure
> ts-node src/index-pure.ts ../samples/sgb-self-test.wav --verbose --fgb-bp-hz=2500 --fgb-candidates=1 --candidates=1

[SGB-TS] [frontend] weak LPF bw=100000Hz taps=81 agc=25ms target=1000 ms=489.2
[fgb] carrier candidates=1
[fgb] cand#0 fft=0.000Hz phaseFit=986.872Hz score=2060.2 start=2826240 postMixLpf=2500Hz
[fgb] no frame after headers=6/42900 full=0 exactSyncHeaders=0 rejectsLogged=0 bitGrid=1/32 startStepMs=5
[SGB-TS] [fgb] no BCH-valid FGB frame, continuing with SGB PRN acquisition
[SGB-TS] [rt-fft512] start cfoCenter=0.000Hz depth=1200 bins=19 hop=50 patch=512
[SGB-TS] [rt-fft512] bank workers=4 workerMs=1983.3 forwardFFTs=31160 reverseFFTs=124640 directScores=310961 patch=512 coarseHop=200 refineRadius=100 modes=2 cfoBins=19 kept=64
[SGB-TS] try#1 mode=self_test trim=819000 cfo=0 boxcar=10 off=0 phase=0 detLevel=1385.4
[SGB-TS] BCH-valid candidate after 1 despread attempts; nerr=0
[SGB-TS] [timing] read+dc=524.1 ms acqPrep=8.9 ms detector=1985.8 ms oracle=35.7 ms total=2902.1 ms tries=1
SIGNAL_KIND SGB
ACQ {
  sampleRate: 1536000,
  samplesPerChip: 40,
  mode: 'self_test',
  cfoHz: 7.515146524605988,
  trimSample: 819000,
  chipOffset: 0,
  boxcarOffset: 10,
  phaseDeg: 84.27810085739733,
  correctedErrors: 0,
  qSense: 1
}
TIMING {
  readDcMs: 524.1217999999999,
  acqPrepMs: 8.9074999999998,
  detectorMs: 1985.8099000000002,
  oracleMs: 35.74339999999984,
  totalMs: 2902.1005999999998,
  tries: 1
}
RAW_BINARY_250 0000000011100110000010001111010011100011001001010111001101010101010000000010111010101010110000000000000000000000000000000000000000000000000111111111111111000000000000000000000111111111100000000001011000000100101001101100110000110000011110001100101010
CORRECTED_BINARY_250 0000000011100110000010001111010011100011001001010111001101010101010000000010111010101010110000000000000000000000000000000000000000000000000111111111111111000000000000000000000111111111100000000001011000000100101001101100110000110000011110001100101010
CORRECTED_HEX_250 0039823D38C95CD5500BAAB0000000000007FFF000007FE0058129B30C1E32A