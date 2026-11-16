# SarsatSDR

`sarsat-sdr` recoit et decode les balises COSPAS-SARSAT 406 MHz de premiere
generation (FGB) et de deuxieme generation (SGB).

Moteur C++20 commun a Windows et Android, interface React Native / Web,
acquisition RTL-SDR USB et lecture de captures WAV I/Q. Le moteur fonctionne
aussi en ligne de commande, sans interface.

## Fonctionnalites

- Reception RTL-SDR a 921600 echantillons complexes/s, R820T/R820T2/R828D et
  RTL-SDR Blog V4, FE_AGC et douze presets de gain. Bias-T desactive.
- Acquisition libusb asynchrone, worker DSP et files bornees ; deconnexions,
  saturations et discontinuites signalees explicitement.
- Decodage FGB/SGB, mots bruts et corriges, identification et position balise,
  frequence, horodatage, diagnostics d'acquisition et traces phase/I/Q.
- BCH : capacite FGB BCH-1 de 3 bits, BCH-2 de 2 bits ; SGB de 6 bits.
  Limites de rejet configurables, corrections et ecarts d'en-tete affiches.
  Les trames courtes et d'orbitographie FGB ne produisent pas de statut BCH-2.
- Navigation en bas : RECEIVER, Frames, MAP, Signal, Player et Settings.
- Spectre sur 406,000..406,100 MHz, 1024 bins, 10 spectres/s ; waterfall GPU
  a sept couleurs discretes et points des quatre candidats FGB actifs.
- Defilement anime de 0,25x a 4x, defaut 1x : historique visible de 28 a
  1,75 secondes, sept secondes par defaut. Texture et position sont synchronisees
  dans un meme rendu Skia sur Android pour eviter les retours arriere.
- Historique de 200 trames, detail des champs, export JSON, carte OpenStreetMap
  et liens Google Maps / Waze. La carte requiert Internet.
- Lecture temps reel des neuf captures embarquees ; ouverture de WAV utilisateur
  sur Android. PCM stereo I/Q 8 bits, 16 bits et flottant 32 bits.

L'identite visuelle reprend [SarsatJRXApp](https://github.com/fredzo/SarsatJRXApp/) :
fonds sombres vert/noir, en-tete petrole, accents cyan, texte blanc,
icones Lucide et boutons de navigation cartographique bleus.

## Organisation

- `native/cospas-core` : moteur portable, tables DSP integrees et API C.
- `native/sources` : WAV, RTL2832, tuner R820 et transport USB.
- `native/cospas-cli` : executable headless et evenements JSONL.
- `native/android` : compilation Android et adaptateur JNI.
- `apps/mobile` : application Expo / React Native et interface Web partagee.
- `apps/diagnostic-web` : serveur HTTP/WebSocket local et tests UI, sans front distinct.
- `packages/shared` : protocole, profils de lecture et affichage.
- `samples` : captures de regression, attentes documentees et profils JSON.
- `spec` : specifications FGB/SGB.

Les archives locales ne sont ni compilees, ni requises pour construire le projet.
Les tables FIR, PN, repliques FFT et registres sont integrees dans
`native/cospas-core/dsp_tables.hpp` ; aucune extraction de binaire n'est effectuee.
[CONTEXT.md](CONTEXT.md) decrit les objectifs architecturaux, pas une liste de
fonctionnalites toutes disponibles.

## Compilation Windows

Prerequis : CMake 3.24+, Ninja, compilateurs C11/C++20, Python 3 pour les tests,
FFTW simple precision et libusb 1.0.
Les DLL du compilateur, FFTW et libusb doivent figurer dans `PATH`, y compris
pendant les tests et lors du lancement du pont local.

Exemple MSYS2 UCRT64 :

```powershell
rtk proxy cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_PREFIX_PATH=D:\msys64\ucrt64
rtk proxy cmake --build build
rtk ctest --test-dir build --output-on-failure
```

Le build fournit `cospas-core`, `cospas-rtl-control`, `cospas-c-api.dll`,
`cospas-cli.exe` et les executables de test.

Pour l'interface, ajouter Node.js 22.12+ (ou 24+) et npm :

```powershell
rtk npm install
rtk proxy npm run ui:build
rtk proxy npm run ui:start
```

Ouvrir **http://127.0.0.1:4173**. Le serveur ecoute seulement sur loopback ;
`SARSAT_UI_PORT` change son port. La production sert `apps/mobile/dist`, meme
interface que sur Android ; aucun ancien front de diagnostic n'est conserve.
Le pont lance `build\cospas-cli.exe` et ne transporte aucun I/Q brut.

## Application Android

`apps/mobile` : Expo / React Native, application **SarsatSDR**,
paquet `org.adrasec.f4jrx.sarsatsdr`, minSdk 26, arm64-v8a et x86_64.
Le CLI embarque, FFTW et libusb sont lies dans `libsarsat-native.so`,
appelee par le module Expo local via JNI.

Sources : cle RTL-SDR USB OTG (permission Android et service premier plan),
captures embarquees et WAV choisi avec `OUVRIR WAV`.
Les captures ajoutent environ 350 Mo a l'APK ; un WAV est charge en RAM.
Le tuner attend 10 ms avant chacun des deux controles de verrouillage PLL,
notamment apres debranchement/rebranchement. Un verrouillage absent reste une erreur.

Prerequis : JDK 17, SDK Android platform 37, NDK 27.1.12297006 et CMake 3.22.1.
Build local :

```powershell
cd apps\mobile
rtk proxy npx expo prebuild -p android --no-install
cd android
rtk proxy .\gradlew.bat assembleRelease --max-workers=2
rtk proxy adb install -r app\build\outputs\apk\release\app-release.apk
```

Sous Windows, activer LongPathsEnabled et utiliser Ninja >= 1.12 si necessaire.
Derriere un proxy TLS d'entreprise, le magasin de certificats Windows peut etre
utilise avec `JAVA_TOOL_OPTIONS=-Djavax.net.ssl.trustStoreType=Windows-ROOT`.
L'APK release utilise actuellement la cle debug Expo : definir une vraie cle
avant diffusion. Les profils EAS `preview` et `production` sont fournis ;
une compilation EAS sans `--local` televerse le code vers les serveurs Expo.

## Utilisation

`RECEVOIR` ouvre la cle ; `STOP` attend la fermeture USB et le vidage DSP avant
une autre session. Avec plusieurs cles, choisir bus/adresse dans Settings.
Les reglages sont geles pendant une session et ne sont pas encore sauvegardes.

Defauts DSP :

| Parametre | Defaut |
|---|---|
| FGB OverPeak / moyenne / RunTime | 15 dB / 0,045 / 550 ms |
| FGB PLL Alpha / Beta / Zeta | 0,1 / 0,01 / 0,01 |
| FGB BCH-1 / BCH-2 / erreurs d'en-tete | 3 / 2 / 2 |
| SGB seuil / Alpha / Beta / TC / FB | 35 / 0,83 / 3,81 / 0,5 / 4 |
| SGB limite BCH / PRN / qualite | 5 / Late / actif |
| Search Depth | 9, indices -9..+9 par pas de 150 Hz |
| Gain initial UI / FE_AGC | preset 8 / actif |
| FFT Average / WF Base / WF Range | 0,5 / 27 / 11 |

La limite SGB de rejet est distincte de la capacite mathematique de six corrections.
`Afficher BCH invalides / hors seuil` conserve explicitement les echecs et affiche
`HORS SEUIL` si necessaire ; ce mode ne constitue pas une validation des trames.
Le Search Depth est affiche suivant l'echelle `position * 1,2 / 9` kHz.

La FFT utilise une demi-fenetre Blackman doublee, la reponse des deux FIR
et le maximum des bins par pixel. Les niveaux sont indicatifs, non calibres en dBm.
La couleur est `Round((Round(niveau) + 180) * (100 - Range) / 600 - Base / 10)`,
saturee entre 0 et 6, arrondi au pair. Base/Range recolorent aussi l'historique.
Les points FFT indiquent des essais FGB avant BCH, pas des trames validees.

Dans Player, choisir une capture puis `LIRE`. Le profil valide, actif par
defaut, applique DC, prechauffage et PLL selon `samples/playback-profiles.json`,
sans changer les reglages de reception radio. Le mode manuel utilise Settings.
Le retrait DC n'est jamais implicite ; `dcRemovalApplied` l'indique dans le JSON.
Le prechauffage repete les 200 premieres millisecondes du WAV, qui peuvent deja
contenir une porteuse. Les temps publies excluent ce prefixe.

Frames presente les trames et leurs champs ; selectionner une trame puis
`OUVRIR SIGNAL` pour voir ses traces FGB ou SGB dans Signal. Sans selection
explicite, la derniere trame recue est affichee. Une selection explicite reste
active pendant les receptions suivantes. MAP utilise la selection localisee
ou la derniere trame contenant une position.

## Mode headless

```powershell
rtk proxy .\build\cospas-cli.exe --help
rtk proxy .\build\cospas-cli.exe devices --json
rtk proxy .\build\cospas-cli.exe decode --input .\samples\sgb.wav --sgb-only
rtk proxy .\build\cospas-cli.exe decode --input .\samples\sgb-cnes.wav --sgb-only --remove-dc
rtk proxy .\build\cospas-cli.exe decode --input .\samples\fgb.wav --fgb-only --noise-preroll-ms 2000
rtk proxy .\build\cospas-cli.exe decode --input .\samples\sgb.wav --sgb-only --block-samples 4093 --worker-queue 2
rtk proxy .\build\cospas-cli.exe receive --frequency-hz 406050000 --gain-index 8 --agc --seconds 5 --json
```

Sorties : `0` avec trame, `2` sans trame, `1` sur erreur. `devices` et
`rtl-probe` retournent `0` pour une operation reussie, meme sans cle detectee.
Le JSON de trame contient bits bruts/corriges, BCH et nombres de corrections,
`headerErrors`, temps, decalage frequentiel et `fields: [{section, name, value}]`.
`tablesSha256` identifie les tables DSP integrees ; les spectres JSONL portent
`displayOffsetDb`, et la reception expose `dspOffsetHz`.

Le centre decode est distinct du centre tuner : decalage DSP par defaut -70 kHz,
NCO apres le FIR55 et avant le FIR104, avec compensation de l'erreur PLL.
`--events` active JSONL : session, spectrum, metrics, frame et complete.
`--events --continuous --control-stdin` retire la borne de duree de reception ;
`stop` suivi d'un saut de ligne, ou la fermeture du pipe, demande un arret ordonne.
`decode --events --realtime` cadence le WAV sans changer ses bits.

## API C

Contrat : [c_api.h](native/cospas-core/include/cospas/c_api.h), cible
`cospas-c-api`. Verifier `cs_abi_version()` et initialiser avec `cs_config_init`.
Le header C++ public est `cospas/decoder.hpp`.

- `cs_decode_iq` : traitement par lots CU8/CS16/CF32, taux de 76800 a 10000000 Hz.
  Tailles en octets, I/Q entrelaces, buffer emprunte pendant l'appel.
- `cs_stream_*` : traitement incremental, indice du premier echantillon complexe,
  blocs bornes et refus explicite des trous/recouvrements. Reset obligatoire
  apres discontinuite ou erreur ; finish vide la fin puis interdit les pushes.
- `cs_worker_*` : un producteur, un consommateur, files SPSC preallouees.
  Submit copie sans attendre le DSP ; file pleine : `CS_QUEUE_FULL`.
  Les evenements transmettent la propriete du resultat au consommateur.
- `cs_result_get_*` : consultation des trames/diagnostics et traces empruntees.
  `cs_result_destroy` libere le resultat ; celui-ci survit a la destruction du flux.
- Les echecs retournent statut et `cs_error`, sans etat global silencieux.
  Les appels synchrones allouent ; ne pas les executer dans un callback USB.

Les champs finaux de configuration et `cs_frame.header_errors` etendent ABI v1
avec controle de taille. Le membre de diagnostic `tables_sha256` conserve la
taille et la position memoire du champ de 65 caracteres. Les consommateurs C/C++
doivent etre recompiles avec les noms publics actuels.
Les plans FFTW imposent de serialiser creation et appels par lots.

## Validation

```powershell
rtk ctest --test-dir build --output-on-failure
rtk ctest --test-dir build -L samples --output-on-failure
rtk ctest --test-dir build -L rtl --output-on-failure
rtk proxy npm run ui:test
rtk proxy npm run ui:build
```

Les neuf captures sont verifiees par lots, en incremental et en worker, avec
comparaison aux attentes documentees : mots proteges, corrections et absence de
trames distinctes supplementaires. Les BCH-2 documentes invalides sont signales ;
les valeurs attendues ne sont jamais injectees dans le moteur.
Tests additionnels : contrat C, equivalence des formats I/Q, continuite NCO,
registres RTL, PLL, reconnexion, erreurs USB, saturation et arret des workers.
Les tests UI verifient notamment les neuf lectures temps reel via JSONL.

## Limites et distribution

Enregistrement I/Q, pause/recherche temporelle, sauvegarde des reglages,
calibration dBm, integrations iOS et sources reseau/SigMF restent a completer.
Les WAV sont encore charges en entier ; la reception USB utilise des files bornees.
Les regressions sur captures ne remplacent pas des mesures RF de sensibilite,
de faux positifs et d'endurance.

FFTW 3.3.10 (GPL) et libusb 1.0.30 (LGPL) sont disponibles dans
`native/third_party`, avec leurs licences. L'APK lie FFTW statiquement et releve
donc de la GPL. Lucide utilise la licence ISC et Leaflet la licence BSD-2-Clause.
Les conditions des composants et donnees tiers restent applicables ;
aucun droit de redistribution supplementaire n'est implique.
La licence du projet et des donnees DSP doit etre clarifiee avant diffusion.
