### Frame content for ```cnes-short-1.wav``` file
## Content
- 1 SGB frame at 406.050 MHz (Center Frequency)

## SGB 250 data bits
``````

## SGB Hex data (63 hex char as per COSPAS/SARSAT specifictaion)
```3FFFE1A738C95C7BE00BD8BE00000000001FFFF0FFFF7FFFEF0470400A448FD```


## C tool implementation log
./build/dec406_iq ./406/cnes-short-1.wav -s 1536000 -i
Rate: 1536000 Hz  SPS: 40.000
File: 20.8 MB, 5204430 samples (3.4 s)
Scan t=0.00s...<7>[freq_acq] fft-corr NORMAL PRN: coarse reject conf 1.7 (need >=5)  offset 6760 Hz  lag 3017/8063 (n_chips 12000 remain 8983)  peak 1.51e+11  median 8.81e+10  mean 9.01e+10  phase 0
<7>[freq_acq] fft-corr SELF-TEST PRN: coarse reject conf 1.7 (need >=5)  offset 7540 Hz  lag 6563/8063 (n_chips 12000 remain 5437)  peak 1.52e+11  median 8.75e+10  mean 8.92e+10  phase 1
<7>[freq_acq] fft-corr selected SELF-TEST PRN (conf 1.7)
<7>[dsss_demod] acquisition widening to +/-16000 Hz (first freq=7540 Hz conf=1.7, prn=SELF-TEST, need >=8.0)
<7>[freq_acq] fft-corr NORMAL PRN: coarse reject conf 1.8 (need >=5)  offset -4840 Hz  lag 4063/8063 (n_chips 12000 remain 7937)  peak 1.60e+11  median 8.81e+10  mean 8.99e+10  phase 0
<7>[freq_acq] fft-corr SELF-TEST PRN: coarse reject conf 1.8 (need >=5)  offset -13288 Hz  lag 3415/8063 (n_chips 12000 remain 8585)  peak 1.61e+11  median 8.76e+10  mean 8.94e+10  phase 1
<7>[freq_acq] fft-corr selected SELF-TEST PRN (conf 1.8)
<7>[dsss_demod] acquisition rejected (freq=-13288 Hz conf=1.8, prn=SELF-TEST, need >=8.0)
Scan t=0.25s...<7>[freq_acq] fft-corr NORMAL PRN: offset 875 Hz  conf 47.3  lag 1104/8063 (n_chips 12000 remain 10896)  peak 1.63e+13  median 3.44e+11  mean 3.77e+11  phase 0
<7>[freq_acq] fft-corr SELF-TEST PRN: offset 883 Hz  conf 5.1  lag 4213/8063 (n_chips 12000 remain 7787)  peak 1.78e+12  median 3.47e+11  mean 3.58e+11  phase 0
<7>[freq_acq] fft-corr selected NORMAL PRN (conf 47.3)
<7>[dsss_demod] acquisition accepted in +/-8000 Hz window
<7>[dsss_demod] selected SGB PRN NORMAL
<7>[despread] SYNC FAILED (NORMAL PRN): I z=10.7 Q z=4.2 combined=11.5 (need 20.0) peak=2.220e+02 2nd=1.223e+02 z1/z2=10.7/5.1=2.12 lag1=1104 lag2=5296 mean=3.319e+01 std=1.766e+01
<7>[despread] SYNC FAILED (NORMAL PRN): I z=15.2 Q z=5.8 combined=16.3 (need 20.0) peak=3.025e+02 2nd=1.223e+02 z1/z2=15.2/5.0=3.03 lag1=1104 lag2=7964 mean=3.345e+01 std=1.770e+01
<7>[despread] Synced (NORMAL PRN): off_I=1104 (z=21.6), off_Q=1104 (z=8.0), combined=23.0, phase=90°, z1/z2=21.6/5.6=3.84 lag2=2933
<7>[despread] Synced (NORMAL PRN): off_I=1104 (z=65.2), off_Q=1104 (z=33.2), combined=73.1, phase=270°, z1/z2=65.2/4.1=15.72 lag2=8739
<7>[despread] SYNC FAILED (NORMAL PRN): I z=12.8 Q z=4.9 combined=13.7 (need 20.0) peak=2.577e+02 2nd=1.264e+02 z1/z2=12.8/5.3=2.41 lag1=1104 lag2=5604 mean=3.327e+01 std=1.761e+01
<7>[despread] SYNC FAILED (NORMAL PRN): I z=13.8 Q z=5.3 combined=14.8 (need 20.0) peak=2.801e+02 2nd=1.141e+02 z1/z2=13.8/4.5=3.06 lag1=1104 lag2=4726 mean=3.338e+01 std=1.788e+01
<7>[despread] SYNC FAILED (NORMAL PRN): I z=8.5 Q z=3.5 combined=9.2 (need 20.0) peak=1.812e+02 2nd=1.225e+02 z1/z2=8.5/5.1=1.66 lag1=1104 lag2=5718 mean=3.309e+01 std=1.745e+01
<7>[despread] Synced (NORMAL PRN): off_I=1104 (z=65.2), off_Q=1104 (z=33.2), combined=73.1, phase=270°, z1/z2=65.2/4.1=15.72 lag2=8739
<7>[despread] preamble fit: intercept=1.343 slope=-0.0054 rad/bit (-0.13 Hz) phase_rad=1.207
<7>[dsss_demod] offset 0/40 phase 0° z=73 nerr=0
<7>[dsss_demod] BCH validated: boxcar offset 0/40 Costas phase 0° nerr=0
<7>[dsss_demod] bits250=FFFF869CE32571EF802F62F800000000007FFFC3FFFDFFFFBC11C10029123F4
  Sync at t=0.25s (z=73.1)
Scan t=0.50s...<7>[freq_acq] fft-corr NORMAL PRN: coarse reject conf 2.3 (need >=5)  offset 880 Hz  lag 1423/8063 (n_chips 12000 remain 10577)  peak 7.91e+11  median 3.41e+11  mean 3.51e+11  phase 1
<7>[freq_acq] fft-corr SELF-TEST PRN: coarse reject conf 1.8 (need >=5)  offset 868 Hz  lag 5778/8063 (n_chips 12000 remain 6222)  peak 6.27e+11  median 3.45e+11  mean 3.54e+11  phase 1
<7>[freq_acq] fft-corr selected NORMAL PRN (conf 2.3)
<7>[dsss_demod] acquisition widening to +/-16000 Hz (first freq=880 Hz conf=2.3, prn=NORMAL, need >=8.0)
<7>[freq_acq] fft-corr NORMAL PRN: coarse reject conf 2.3 (need >=5)  offset 872 Hz  lag 1423/8063 (n_chips 12000 remain 10577)  peak 7.94e+11  median 3.45e+11  mean 3.52e+11  phase 1
<7>[freq_acq] fft-corr SELF-TEST PRN: coarse reject conf 1.8 (need >=5)  offset 884 Hz  lag 986/8063 (n_chips 12000 remain 11014)  peak 6.19e+11  median 3.44e+11  mean 3.53e+11  phase 0
<7>[freq_acq] fft-corr selected NORMAL PRN (conf 2.3)
<7>[dsss_demod] acquisition rejected (freq=872 Hz conf=2.3, prn=NORMAL, need >=8.0)
Scan t=0.75s...<7>[freq_acq] fft-corr NORMAL PRN: offset 869 Hz  conf 5.9  lag 1118/8063 (n_chips 12000 remain 10882)  peak 2.01e+12  median 3.43e+11  mean 3.53e+11  phase 1
<7>[freq_acq] fft-corr SELF-TEST PRN: coarse reject conf 3.3 (need >=5)  offset 868 Hz  lag 6217/8063 (n_chips 12000 remain 5783)  peak 1.13e+12  median 3.45e+11  mean 3.54e+11  phase 1
<7>[freq_acq] fft-corr selected NORMAL PRN (conf 5.9)
<7>[dsss_demod] acquisition widening to +/-16000 Hz (first freq=869 Hz conf=5.9, prn=NORMAL, need >=8.0)
<7>[freq_acq] fft-corr NORMAL PRN: offset 869 Hz  conf 6.0  lag 1118/8063 (n_chips 12000 remain 10882)  peak 2.06e+12  median 3.46e+11  mean 3.55e+11  phase 1
<7>[freq_acq] fft-corr SELF-TEST PRN: coarse reject conf 3.3 (need >=5)  offset 872 Hz  lag 6217/8063 (n_chips 12000 remain 5783)  peak 1.15e+12  median 3.45e+11  mean 3.54e+11  phase 1
<7>[freq_acq] fft-corr selected NORMAL PRN (conf 6.0)
<7>[dsss_demod] acquisition rejected (freq=869 Hz conf=6.0, prn=NORMAL, need >=8.0)
Scan t=1.00s...<7>[freq_acq] fft-corr NORMAL PRN: coarse reject conf 4.6 (need >=5)  offset 880 Hz  lag 2141/8063 (n_chips 12000 remain 9859)  peak 1.55e+12  median 3.37e+11  mean 3.49e+11  phase 1
<7>[freq_acq] fft-corr SELF-TEST PRN: coarse reject conf 2.4 (need >=5)  offset 880 Hz  lag 719/8063 (n_chips 12000 remain 11281)  peak 8.16e+11  median 3.42e+11  mean 3.52e+11  phase 0
<7>[freq_acq] fft-corr selected NORMAL PRN (conf 4.6)
<7>[dsss_demod] acquisition widening to +/-16000 Hz (first freq=880 Hz conf=4.6, prn=NORMAL, need >=8.0)
<7>[freq_acq] fft-corr NORMAL PRN: coarse reject conf 4.4 (need >=5)  offset 884 Hz  lag 2141/8063 (n_chips 12000 remain 9859)  peak 1.51e+12  median 3.42e+11  mean 3.50e+11  phase 1
<7>[freq_acq] fft-corr SELF-TEST PRN: coarse reject conf 2.2 (need >=5)  offset 884 Hz  lag 719/8063 (n_chips 12000 remain 11281)  peak 7.69e+11  median 3.43e+11  mean 3.52e+11  phase 0
<7>[freq_acq] fft-corr selected NORMAL PRN (conf 4.4)
<7>[dsss_demod] acquisition rejected (freq=884 Hz conf=4.4, prn=NORMAL, need >=8.0)
Scan t=1.25s...<7>[freq_acq] fft-corr NORMAL PRN: coarse reject conf 4.0 (need >=5)  offset 928 Hz  lag 348/8063 (n_chips 12000 remain 11652)  peak 8.62e+11  median 2.18e+11  mean 2.27e+11  phase 1
<7>[freq_acq] fft-corr SELF-TEST PRN: coarse reject conf 2.2 (need >=5)  offset 808 Hz  lag 594/8063 (n_chips 12000 remain 11406)  peak 4.88e+11  median 2.21e+11  mean 2.28e+11  phase 1
<7>[freq_acq] fft-corr selected NORMAL PRN (conf 4.0)
<7>[dsss_demod] acquisition widening to +/-16000 Hz (first freq=928 Hz conf=4.0, prn=NORMAL, need >=8.0)
<7>[freq_acq] fft-corr NORMAL PRN: coarse reject conf 3.9 (need >=5)  offset 920 Hz  lag 348/8063 (n_chips 12000 remain 11652)  peak 8.60e+11  median 2.19e+11  mean 2.28e+11  phase 1
<7>[freq_acq] fft-corr SELF-TEST PRN: coarse reject conf 2.3 (need >=5)  offset 944 Hz  lag 594/8063 (n_chips 12000 remain 11406)  peak 4.98e+11  median 2.20e+11  mean 2.27e+11  phase 1
<7>[freq_acq] fft-corr selected NORMAL PRN (conf 3.9)
<7>[dsss_demod] acquisition rejected (freq=920 Hz conf=3.9, prn=NORMAL, need >=8.0)
Scan t=1.50s...<7>[freq_acq] fft-corr NORMAL PRN: coarse reject conf 1.7 (need >=5)  offset -5948 Hz  lag 7249/8063 (n_chips 12000 remain 4751)  peak 1.48e+11  median 8.56e+10  mean 8.77e+10  phase 0
<7>[freq_acq] fft-corr SELF-TEST PRN: coarse reject conf 1.9 (need >=5)  offset 1132 Hz  lag 2665/8063 (n_chips 12000 remain 9335)  peak 1.61e+11  median 8.53e+10  mean 8.70e+10  phase 0
<7>[freq_acq] fft-corr selected SELF-TEST PRN (conf 1.9)
<7>[dsss_demod] acquisition widening to +/-16000 Hz (first freq=1132 Hz conf=1.9, prn=SELF-TEST, need >=8.0)
<7>[freq_acq] fft-corr NORMAL PRN: coarse reject conf 1.8 (need >=5)  offset 14492 Hz  lag 2083/8063 (n_chips 12000 remain 9917)  peak 1.54e+11  median 8.58e+10  mean 8.78e+10  phase 1
<7>[freq_acq] fft-corr SELF-TEST PRN: coarse reject conf 1.9 (need >=5)  offset 1136 Hz  lag 2665/8063 (n_chips 12000 remain 9335)  peak 1.62e+11  median 8.54e+10  mean 8.73e+10  phase 0
<7>[freq_acq] fft-corr selected SELF-TEST PRN (conf 1.9)
<7>[dsss_demod] acquisition rejected (freq=1136 Hz conf=1.9, prn=SELF-TEST, need >=8.0)
Scan t=1.75s...<7>[freq_acq] fft-corr NORMAL PRN: coarse reject conf 1.9 (need >=5)  offset -6500 Hz  lag 2627/8063 (n_chips 12000 remain 9373)  peak 1.68e+11  median 8.68e+10  mean 8.84e+10  phase 1
<7>[freq_acq] fft-corr SELF-TEST PRN: coarse reject conf 1.7 (need >=5)  offset 6916 Hz  lag 2729/8063 (n_chips 12000 remain 9271)  peak 1.48e+11  median 8.61e+10  mean 8.81e+10  phase 1
<7>[freq_acq] fft-corr selected NORMAL PRN (conf 1.9)
<7>[dsss_demod] acquisition widening to +/-16000 Hz (first freq=-6500 Hz conf=1.9, prn=NORMAL, need >=8.0)
<7>[freq_acq] fft-corr NORMAL PRN: coarse reject conf 2.0 (need >=5)  offset -6496 Hz  lag 2627/8063 (n_chips 12000 remain 9373)  peak 1.70e+11  median 8.65e+10  mean 8.84e+10  phase 1
<7>[freq_acq] fft-corr SELF-TEST PRN: coarse reject conf 2.2 (need >=5)  offset 9440 Hz  lag 7258/8063 (n_chips 12000 remain 4742)  peak 1.88e+11  median 8.65e+10  mean 8.85e+10  phase 1
<7>[freq_acq] fft-corr selected SELF-TEST PRN (conf 2.2)
<7>[dsss_demod] acquisition rejected (freq=9440 Hz conf=2.2, prn=SELF-TEST, need >=8.0)
Scan t=2.00s...<7>[freq_acq] fft-corr NORMAL PRN: coarse reject conf 2.2 (need >=5)  offset 7252 Hz  lag 7586/8063 (n_chips 12000 remain 4414)  peak 1.87e+11  median 8.54e+10  mean 8.72e+10  phase 1
<7>[freq_acq] fft-corr SELF-TEST PRN: coarse reject conf 1.7 (need >=5)  offset 7444 Hz  lag 1112/8063 (n_chips 12000 remain 10888)  peak 1.44e+11  median 8.62e+10  mean 8.81e+10  phase 0
<7>[freq_acq] fft-corr selected NORMAL PRN (conf 2.2)
<7>[dsss_demod] acquisition widening to +/-16000 Hz (first freq=7252 Hz conf=2.2, prn=NORMAL, need >=8.0)
<7>[freq_acq] fft-corr NORMAL PRN: coarse reject conf 2.2 (need >=5)  offset 7256 Hz  lag 7586/8063 (n_chips 12000 remain 4414)  peak 1.89e+11  median 8.55e+10  mean 8.75e+10  phase 1
<7>[freq_acq] fft-corr SELF-TEST PRN: coarse reject conf 1.8 (need >=5)  offset -14176 Hz  lag 2045/8063 (n_chips 12000 remain 9955)  peak 1.53e+11  median 8.64e+10  mean 8.82e+10  phase 0
<7>[freq_acq] fft-corr selected NORMAL PRN (conf 2.2)
<7>[dsss_demod] acquisition rejected (freq=7256 Hz conf=2.2, prn=NORMAL, need >=8.0)

1 windows synced — decoding best (z=73.1)

=== Demodulated bits (hex, 63 chars) ===
3FFFE1A738C95C7BE00BD8BE00000000001FFFF0FFFF7FFFEF0470400A448FD

=== FRAME DECODING ===
Starting 2G decoding...

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