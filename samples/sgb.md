### Frame content for ```sgb.wav``` file
## 250 data bits
```1111111111111111100001101001110011100011001001010111000111101111100000000010111101100010111110000000000000000000000000000000000000000000011111111111111111000011111111111111110111111111111111111011110000010001110000010000000000101001000100100011111101```
## Hex data (63 hex char as per COSPAS/SARSAT specifictaion)
```3FFFE1A738C95C7BE00BD8BE00000000001FFFF0FFFF7FFFEF0470400A448FD```

## IDENTIFICATION
Frame Mode: Normal
23 Hex ID: 9C77FFFE1A7F00000000000
TAC Number: 65535 (0xFFFF)
Serial Number: 8615 (0x21A7)
Country Code: 227 (France)
Type: System Beacon
Vessel ID: Reserved Type

## STATUS
Homing Device: Not Available/Disabled
RLS Capability: Disabled
Test Protocol: Active (Non-operational)

## ENCODED GNSS LOCATION
Position: 43.56049°N, 1.48080°E
Coordinates: 43.56049°N, 1.48080°E
Resolution: ~3.4 meters maximum

## ROTATING FIELD 0
Type: G.008 Objective Requirements
Elapsed time: 63 hours
Last position: 2046 minutes ago
Altitude: Not available
HDOP: DOP not available
VDOP: DOP not available
Battery: Battery capacity not available
GNSS Status: No fix

## Reference implementation log
```
./build/dec406_iq ./406/sgb.wav -s 1536000 -i
Rate: 1536000 Hz  SPS: 40.000
File: 11.6 MB, 2891531 samples (1.9 s)
Scan t=0.00s...[main_iq] burst at blk 24 (230.000 ms), trimming 353280 samples  P10=2.0e-04 P90=2.2e-02
<7>[freq_acq] fft-corr NORMAL PRN: offset -4 Hz  conf 70.5  lag 508/8063 (n_chips 12000 remain 11492)  peak 5.00e+15  median 7.08e+13  mean 7.92e+13  phase 1
<7>[freq_acq] fft-corr SELF-TEST PRN: coarse reject conf 2.7 (need >=5)  offset -8 Hz  lag 3811/8063 (n_chips 12000 remain 8189)  peak 1.92e+14  median 7.08e+13  mean 7.33e+13  phase 1
<7>[freq_acq] fft-corr selected NORMAL PRN (conf 70.5)
<7>[dsss_demod] acquisition accepted in +/-8000 Hz window
<7>[dsss_demod] selected SGB PRN NORMAL
<7>[despread] Synced (NORMAL PRN): off_I=507 (z=13.1), off_Q=507 (z=67.2), combined=68.4, phase=180°, z1/z2=13.1/4.7=2.81 lag2=2751
<7>[despread] Synced (NORMAL PRN): off_I=508 (z=18.6), off_Q=508 (z=95.8), combined=97.5, phase=180°, z1/z2=18.6/3.7=4.97 lag2=4315
<7>[despread] Synced (NORMAL PRN): off_I=508 (z=24.8), off_Q=508 (z=134.2), combined=136.5, phase=180°, z1/z2=24.8/4.8=5.17 lag2=2337
<7>[despread] Synced (NORMAL PRN): off_I=508 (z=47.0), off_Q=508 (z=522.5), combined=524.6, phase=0°, z1/z2=47.0/2.0=23.19 lag2=2754
<7>[despread] Synced (NORMAL PRN): off_I=508 (z=14.8), off_Q=508 (z=74.9), combined=76.3, phase=180°, z1/z2=14.8/5.4=2.72 lag2=2337
<7>[despread] Synced (NORMAL PRN): off_I=508 (z=15.1), off_Q=508 (z=77.8), combined=79.2, phase=180°, z1/z2=15.1/4.5=3.35 lag2=1616
<7>[despread] Synced (NORMAL PRN): off_I=508 (z=12.7), off_Q=508 (z=66.6), combined=67.8, phase=180°, z1/z2=12.7/4.5=2.86 lag2=1309
<7>[despread] Synced (NORMAL PRN): off_I=508 (z=47.0), off_Q=508 (z=522.5), combined=524.6, phase=0°, z1/z2=47.0/2.0=23.19 lag2=2754
<7>[despread] preamble fit: intercept=-3.218 slope=0.0038 rad/bit (0.09 Hz) phase_rad=-3.123
<7>[dsss_demod] offset 0/40 phase 0° z=525 nerr=1
<7>[dsss_demod] BCH validated: boxcar offset 0/40 Costas phase 0° nerr=1
<7>[dsss_demod] bits250=FFFF869CE32571EF802F62F800000000007FFFC3FFFDFFFFBC11C10129123F4
  Sync at t=0.23s (z=524.6)
Scan t=0.25s...[main_iq] burst at blk 0 (0.000 ms), trimming 0 samples  P10=1.9e-04 P90=2.2e-02
<7>[freq_acq] fft-corr NORMAL PRN: offset -8 Hz  conf 6.5  lag 7122/8063 (n_chips 12000 remain 4878)  peak 4.64e+14  median 7.11e+13  mean 7.37e+13  phase 0
<7>[freq_acq] fft-corr SELF-TEST PRN: coarse reject conf 2.7 (need >=5)  offset -8 Hz  lag 3043/8063 (n_chips 12000 remain 8957)  peak 1.92e+14  median 7.14e+13  mean 7.37e+13  phase 1
<7>[freq_acq] fft-corr selected NORMAL PRN (conf 6.5)
<7>[dsss_demod] acquisition widening to +/-16000 Hz (first freq=-8 Hz conf=6.5, prn=NORMAL, need >=8.0)
<7>[freq_acq] fft-corr NORMAL PRN: offset -8 Hz  conf 6.8  lag 7122/8063 (n_chips 12000 remain 4878)  peak 4.84e+14  median 7.15e+13  mean 7.37e+13  phase 0
<7>[freq_acq] fft-corr SELF-TEST PRN: coarse reject conf 2.7 (need >=5)  offset -4 Hz  lag 3043/8063 (n_chips 12000 remain 8957)  peak 1.94e+14  median 7.14e+13  mean 7.36e+13  phase 1
<7>[freq_acq] fft-corr selected NORMAL PRN (conf 6.8)
<7>[dsss_demod] acquisition rejected (freq=-8 Hz conf=6.8, prn=NORMAL, need >=8.0)
Scan t=0.50s...[main_iq] burst at blk 0 (0.000 ms), trimming 0 samples  P10=1.9e-04 P90=2.2e-02
<7>[freq_acq] fft-corr NORMAL PRN: offset -33 Hz  conf 5.3  lag 4887/8063 (n_chips 12000 remain 7113)  peak 3.72e+14  median 7.02e+13  mean 7.32e+13  phase 0
<7>[freq_acq] fft-corr SELF-TEST PRN: offset -2 Hz  conf 5.3  lag 4498/8063 (n_chips 12000 remain 7502)  peak 3.78e+14  median 7.15e+13  mean 7.44e+13  phase 1
<7>[freq_acq] fft-corr selected NORMAL PRN (conf 5.3)
<7>[dsss_demod] acquisition widening to +/-16000 Hz (first freq=-33 Hz conf=5.3, prn=NORMAL, need >=8.0)
<7>[freq_acq] fft-corr NORMAL PRN: offset -33 Hz  conf 5.4  lag 4887/8063 (n_chips 12000 remain 7113)  peak 3.80e+14  median 7.08e+13  mean 7.31e+13  phase 0
<7>[freq_acq] fft-corr SELF-TEST PRN: offset 0 Hz  conf 5.3  lag 4498/8063 (n_chips 12000 remain 7502)  peak 3.80e+14  median 7.12e+13  mean 7.37e+13  phase 1
<7>[freq_acq] fft-corr selected NORMAL PRN (conf 5.4)
<7>[dsss_demod] acquisition rejected (freq=-33 Hz conf=5.4, prn=NORMAL, need >=8.0)

1 windows synced — decoding best (z=524.6)

=== Demodulated bits (hex, 63 chars) ===
3FFFE1A738C95C7BE00BD8BE00000000001FFFF0FFFF7FFFEF0470404A448FD

=== FRAME DECODING ===
Starting 2G decoding...
<7>BCH: 1 errors corrected (1 in codeword, 0 in padding)

=== 406 MHz SECOND GENERATION BEACON (SGB) ===
[IDENTIFICATION]
 Frame Mode: Normal
 23 Hex ID: 9C77FFFE1A7F00000000000
 Corrected 250 bits: 3FFFE1A738C95C7BE00BD8BE00000000001FFFF0FFFF7FFFEF0470400A448FD
 TAC Number: 65535 (0xFFFF)
 Serial Number: 8615 (0x21A7)
 Country Code: 227 (France)
 Type: System Beacon
 Vessel ID: Reserved Type

[STATUS]
 Homing Device: Not Available/Disabled
 RLS Capability: Disabled
 Test Protocol: Active (Non-operational)

[ENCODED GNSS LOCATION]
 Position: 43.56049°N, 1.48080°E
 Coordinates: 43.56049°N, 1.48080°E
 Resolution: ~3.4 meters maximum
https://www.openstreetmap.org/?mlat=43.56049&mlon=1.48080#map=18/43.56049/1.48080


[ROTATING FIELD 0]
 Type: G.008 Objective Requirements
 Elapsed time: 63 hours
 Last position: 2046 minutes ago
 Altitude: Not available
 HDOP: DOP not available
 VDOP: DOP not available
 Battery: Battery capacity not available
 GNSS Status: No fix

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
npm run decode:pure -- ../samples/sgb.wav --verbose --fgb-bp-hz=2500 --fgb-candidates=1 --candidates=1

> sgb-dsss-oqpsk-rx@0.73.0-fgb-cnes-boost-expected-fix decode:pure
> ts-node src/index-pure.ts ../samples/sgb.wav --verbose --fgb-bp-hz=2500 --fgb-candidates=1 --candidates=1

[SGB-TS] [frontend] weak LPF bw=100000Hz taps=81 agc=25ms target=1000 ms=438.7
[fgb] carrier candidates=1
[fgb] cand#0 fft=0.000Hz phaseFit=92.074Hz score=5460.9 start=2396160 postMixLpf=2500Hz
[fgb] no frame after headers=0/42900 full=0 exactSyncHeaders=0 rejectsLogged=0 bitGrid=1/32 startStepMs=5
[SGB-TS] [fgb] no BCH-valid FGB frame, continuing with SGB PRN acquisition
[SGB-TS] [rt-fft512] start cfoCenter=0.000Hz depth=1200 bins=19 hop=50 patch=512
[SGB-TS] [rt-fft512] bank workers=4 workerMs=1938.0 forwardFFTs=27284 reverseFFTs=109136 directScores=311066 patch=512 coarseHop=200 refineRadius=100 modes=2 cfoBins=19 kept=64
[SGB-TS] try#1 mode=normal trim=373560 cfo=0 boxcar=10 off=0 phase=0 detLevel=2502.8
[SGB-TS] BCH-valid candidate after 1 despread attempts; nerr=1
[SGB-TS] [timing] read+dc=476.4 ms acqPrep=10.2 ms detector=1940.8 ms oracle=122.9 ms total=2874.0 ms tries=1
SIGNAL_KIND SGB
ACQ {
  sampleRate: 1536000,
  samplesPerChip: 40,
  mode: 'normal',
  cfoHz: 0,
  trimSample: 373560,
  chipOffset: 0,
  boxcarOffset: 10,
  phaseDeg: 0,
  correctedErrors: 1
}
TIMING {
  readDcMs: 476.3813,
  acqPrepMs: 10.215099999999893,
  detectorMs: 1940.8276999999998,
  oracleMs: 122.90520000000015,
  totalMs: 2873.9644,
  tries: 1
}
RAW_BINARY_250 1111111111111111100001101001110011100011001001010111000111101111100000000010111101100010111110000000000000000000000000000000000000000000011111111111111111000011111111111111110111111111111111111011110000010001110000010000000100101001000100100011111101
CORRECTED_BINARY_250 1111111111111111100001101001110011100011001001010111000111101111100000000010111101100010111110000000000000000000000000000000000000000000011111111111111111000011111111111111110111111111111111111011110000010001110000010000000000101001000100100011111101
CORRECTED_HEX_250 3FFFE1A738C95C7BE00BD8BE00000000001FFFF0FFFF7FFFEF0470400A448FD