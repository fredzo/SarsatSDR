### Frame content for ```cnes-long-1.wav``` file
## Content
- 1 FGB frame at 406.022 MHz (Center Frequency - ~28000 Hz)
- 2 FGB frames at 406.034 MHz (Center Frequency - ~16000 Hz)
- 1 SGB frame at 406.050 MHz (Center Frequency)

### 1st frame (FGB)
## FGB 144 data bits
```111111111111111000101111110011100011000000000000000000000000000000000000000000000000110110111101000011100100000000100001100000010111001101010000```

## FGB Hex data
```FFFE2FCE3000000000000DBD0E4021817350```

### 2nd frame (FGB)
## FGB 144 data bits
```111111111111111011010000110011100100000100001101001110100100100101110101001110011000000001011010000100000000111001011010000111101100010110110011```

## FGB Hex data
```FFFED0CE410D3A497539805A100E5A1EC5B3```

### 3rd frame (FGB)
## FGB 144 data bits
```111111111111111011010000110011100011000100001101001110100011000110000111100011101000010110100100111000000000111001011010000111100010110110011010```

## FGB Hex data
```FFFED0CE310D3A31878E85A4E00E5A1E2D9A```

### 4th frame (SGB)
## SGB 250 data bits
``````

## SGB Hex data (63 hex char as per COSPAS/SARSAT specifictaion)
```3FFFE1A738C95C7BE00BD8BE00000000001FFFF0FFFF7FFFEF0470400A448FD```


## C tool implementation log (SGB Only)
 ./build/dec406_iq ./406/cnes-long-1.wav -s 1536000 -i
Rate: 1536000 Hz  SPS: 40.000
File: 262.3 MB, 65575691 samples (42.7 s)
Scan t=0.00s...<7>[freq_acq] fft-corr NORMAL PRN: coarse reject conf 2.6 (need >=5)  offset -20 Hz  lag 0/8063 (n_chips 12000 remain 12000)  peak 2.29e+11  median 8.96e+10  mean 9.16e+10  phase 0
<7>[freq_acq] fft-corr SELF-TEST PRN: coarse reject conf 2.0 (need >=5)  offset -1688 Hz  lag 3976/8063 (n_chips 12000 remain 8024)  peak 1.76e+11  median 8.94e+10  mean 9.11e+10  phase 1
<7>[freq_acq] fft-corr selected NORMAL PRN (conf 2.6)
(...)
<7>[dsss_demod] acquisition rejected (freq=872 Hz conf=3.5, prn=NORMAL, need >=8.0)
Scan t=40.75s...<7>[freq_acq] fft-corr NORMAL PRN: coarse reject conf 2.2 (need >=5)  offset 5248 Hz  lag 8057/8063 (n_chips 12000 remain 3943)  peak 1.91e+11  median 8.59e+10  mean 8.76e+10  phase 0
<7>[freq_acq] fft-corr SELF-TEST PRN: coarse reject conf 2.0 (need >=5)  offset -1304 Hz  lag 1892/8063 (n_chips 12000 remain 10108)  peak 1.72e+11  median 8.55e+10  mean 8.75e+10  phase 0
<7>[freq_acq] fft-corr selected NORMAL PRN (conf 2.2)
<7>[dsss_demod] acquisition widening to +/-16000 Hz (first freq=5248 Hz conf=2.2, prn=NORMAL, need >=8.0)
<7>[freq_acq] fft-corr NORMAL PRN: coarse reject conf 2.2 (need >=5)  offset 5240 Hz  lag 8057/8063 (n_chips 12000 remain 3943)  peak 1.93e+11  median 8.58e+10  mean 8.77e+10  phase 0
<7>[freq_acq] fft-corr SELF-TEST PRN: coarse reject conf 2.1 (need >=5)  offset -1312 Hz  lag 1892/8063 (n_chips 12000 remain 10108)  peak 1.78e+11  median 8.55e+10  mean 8.74e+10  phase 0
<7>[freq_acq] fft-corr selected NORMAL PRN (conf 2.2)
<7>[dsss_demod] acquisition rejected (freq=5240 Hz conf=2.2, prn=NORMAL, need >=8.0)
Scan t=41.00s...<7>[freq_acq] fft-corr NORMAL PRN: coarse reject conf 1.9 (need >=5)  offset -7604 Hz  lag 2467/8063 (n_chips 12000 remain 9533)  peak 1.70e+11  median 8.90e+10  mean 9.08e+10  phase 1
<7>[freq_acq] fft-corr SELF-TEST PRN: coarse reject conf 2.0 (need >=5)  offset -7760 Hz  lag 3545/8063 (n_chips 12000 remain 8455)  peak 1.73e+11  median 8.88e+10  mean 9.10e+10  phase 0
<7>[freq_acq] fft-corr selected SELF-TEST PRN (conf 2.0)
<7>[dsss_demod] acquisition widening to +/-16000 Hz (first freq=-7760 Hz conf=2.0, prn=SELF-TEST, need >=8.0)
<7>[freq_acq] fft-corr NORMAL PRN: coarse reject conf 1.9 (need >=5)  offset -7600 Hz  lag 2467/8063 (n_chips 12000 remain 9533)  peak 1.68e+11  median 8.87e+10  mean 9.06e+10  phase 1
<7>[freq_acq] fft-corr SELF-TEST PRN: coarse reject conf 2.1 (need >=5)  offset -12556 Hz  lag 3506/8063 (n_chips 12000 remain 8494)  peak 1.84e+11  median 8.89e+10  mean 9.09e+10  phase 1
<7>[freq_acq] fft-corr selected SELF-TEST PRN (conf 2.1)
<7>[dsss_demod] acquisition rejected (freq=-12556 Hz conf=2.1, prn=SELF-TEST, need >=8.0)
Scan t=41.25s...<7>[freq_acq] fft-corr NORMAL PRN: coarse reject conf 1.7 (need >=5)  offset 5524 Hz  lag 3147/8063 (n_chips 12000 remain 8853)  peak 1.51e+11  median 8.77e+10  mean 8.98e+10  phase 0
<7>[freq_acq] fft-corr SELF-TEST PRN: coarse reject conf 1.7 (need >=5)  offset -5768 Hz  lag 3713/8063 (n_chips 12000 remain 8287)  peak 1.52e+11  median 8.75e+10  mean 8.94e+10  phase 0
<7>[freq_acq] fft-corr selected SELF-TEST PRN (conf 1.7)
<7>[dsss_demod] acquisition widening to +/-16000 Hz (first freq=-5768 Hz conf=1.7, prn=SELF-TEST, need >=8.0)
<7>[freq_acq] fft-corr NORMAL PRN: coarse reject conf 1.8 (need >=5)  offset -6412 Hz  lag 5259/8063 (n_chips 12000 remain 6741)  peak 1.54e+11  median 8.76e+10  mean 8.95e+10  phase 1
<7>[freq_acq] fft-corr SELF-TEST PRN: coarse reject conf 1.7 (need >=5)  offset 8804 Hz  lag 2324/8063 (n_chips 12000 remain 9676)  peak 1.51e+11  median 8.76e+10  mean 8.93e+10  phase 0
<7>[freq_acq] fft-corr selected NORMAL PRN (conf 1.8)
<7>[dsss_demod] acquisition rejected (freq=-6412 Hz conf=1.8, prn=NORMAL, need >=8.0)

1 windows synced — decoding best (z=75.1)

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
