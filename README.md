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
  saturations et discontinuites signalees explicitement. Si la file DSP est
  pleine, le bloc est conserve et resoumis. En cas de debordement fatal,
  l'interface garde l'erreur affichee et relance l'acquisition RTL-SDR.
- Decodage FGB/SGB, mots bruts et corriges, identification et position balise,
  frequence, horodatage, diagnostics d'acquisition et traces phase/I/Q.
- BCH : capacite FGB BCH-1 de 3 bits, BCH-2 de 2 bits ; SGB de 6 bits.
  Limites de rejet configurables, corrections et ecarts d'en-tete affiches.
  Les trames courtes et d'orbitographie FGB ne produisent pas de statut BCH-2.
- Interface en anglais, navigation en bas : Detection, Frames, Map, Detail, Signal,
  Receiver, Player et Settings. Sur Android, la liste des cles RTL-SDR
  s'actualise automatiquement au branchement ou au debranchement.
  Fleches autour de `Frames (x/y)` pour parcourir
  les trames visibles ; chaque nouvelle reception non filtree devient la selection active.
  Detail transmet la trame selectionnee au decodeur COSPAS-SARSAT externe
  quand l'onglet est affiche.
- Detection : tableau de bord fixe en quatre zones (spectre/waterfall,
  liste des trames, detail essentiel et carte), adapte aux tablettes paysage.
  Frames : tableau a gauche et detail complet a droite, avec defilements
  independants si necessaire. Map : carte sans
  defilement de page, gestes de zoom et deplacement disponibles.
- Spectre sur 406,000..406,100 MHz, 1024 bins, 10 spectres/s ; waterfall GPU
  a sept couleurs discretes et points des quatre candidats FGB actifs.
- Defilement anime de 0,25x a 4x, defaut 1x : historique visible de 28 a
  1,75 secondes, sept secondes par defaut. Texture et position sont synchronisees
  dans un meme rendu Skia sur Android pour eviter les retours arriere.
- Historique de 200 trames, detail des champs, export JSON, carte OpenStreetMap
  et liens Google Maps / Waze. La carte requiert Internet.
- Audio FM FGB sur RTL-SDR et WAV (Android et Web), active par defaut et
  volume par defaut a 50 %, independant des notifications. Squelch reglable
  de 0 a 60 dB au-dessus du bruit (15 dB par defaut), applique au prochain
  demarrage sans modifier la detection FGB. Le candidat admissible le plus fort
  ouvre l'audio seulement apres confirmation d'une porteuse non modulee
  en tete de trame, puis reste a l'ecoute jusqu'a sa disparition, sans attendre le BCH. Audio FM
  coupe pendant les 2 premieres secondes de chaque acquisition RTL-SDR.
- Notifications MP3 distinctes pour BCH OK, KO et trames filtrees. Sur Android,
  chaque son est precharge et joue une fois a volume inaudible au lancement ;
  volume commun
  reglable. Filtres d'affichage BCH KO et `Filter system frames` (FGB ORB / SGB SYSTM),
  reversibles sans perdre les trames stockees ni les exclure de l'export.
- Spinner d'acquisition et countdown FGB de 50 s par defaut, relance par chaque
  FGB non filtree. Beeps graves a 5/4/3/2 s puis aigu a 1 s, auto-relance optionnelle ;
  compteur croissant modulo 1000 au demarrage et apres expiration sans auto-relance.
  Appui long : remise a zero en mode croissant jusqu'a la prochaine FGB non filtree,
  avec un double bip, sans modifier le reglage d'auto-relance. Sons, countdown et beeps actives par defaut,
  filtres et auto-relance desactives. Ces reglages sont memorises sur l'appareil.
- Lecture temps reel des neuf captures embarquees ; ouverture de WAV utilisateur
  sur Android. PCM stereo I/Q 8 bits, 16 bits et flottant 32 bits.

## Organisation

- `native/cospas-core` : moteur portable, tables DSP integrees et API C.
- `native/sources` : WAV, RTL2832, tuner R820 et transport USB.
- `native/cospas-cli` : executable headless et evenements JSONL.
- `native/android` : compilation Android et adaptateur JNI.
- `apps/mobile` : application Expo / React Native et interface Web partagée.
- `apps/diagnostic-web` : serveur HTTP/WebSocket local et tests UI, sans front distinct.
- `packages/shared` : protocole, profils de lecture et affichage.
- `samples` : captures de regression, attentes documentees et profils JSON.
- `spec` : specifications FGB/SGB.


## Installation des prerequis sous Windows

Cette procedure part d'un poste Windows 10/11 x64 vierge. Utiliser **MSYS2 UCRT64** pour compiler le moteur Windows et **Invite de commandes Windows (`cmd.exe`)** pour Node.js, Android et ADB. Installer le depot dans un chemin court sans accent, par exemple `C:\src\sarsat-sdr`.

Pour la version PC, suivre les etapes 1 a 3 et, pour la reception RTL-SDR,
l'etape 6. Les etapes 4 et 5 servent uniquement a construire l'APK Android ;
installer un APK deja genere ne requiert que Platform-Tools pour le deploiement ADB.

### 1. Git et chemins longs

Installer [Git for Windows](https://git-scm.com/download/win), puis verifier dans `cmd.exe` :

```bat
git --version
```

Activer les chemins longs dans une **Invite de commandes lancee en tant qu'administrateur**, puis redemarrer Windows :

```bat
reg add "HKLM\SYSTEM\CurrentControlSet\Control\FileSystem" /v LongPathsEnabled /t REG_DWORD /d 1 /f
```

Cloner le depot :

```bat
mkdir C:\src
cd /d C:\src
git clone https://github.com/fredzo/SarsatSDR.git sarsat-sdr
cd /d C:\src\sarsat-sdr
```

### 2. MSYS2 UCRT64, compilateur et bibliotheques natives

1. Installer [MSYS2](https://www.msys2.org/) dans `C:\msys64`.
2. Ouvrir **MSYS2 UCRT64**, et non le terminal MSYS ou MINGW64.
3. Mettre le systeme a jour. Relancer UCRT64 et repeter si le terminal demande de se fermer :

```bash
pacman -Syu
```

4. Installer la chaine complete :

```bash
pacman -S --needed \
  mingw-w64-ucrt-x86_64-gcc \
  mingw-w64-ucrt-x86_64-cmake \
  mingw-w64-ucrt-x86_64-ninja \
  mingw-w64-ucrt-x86_64-python \
  mingw-w64-ucrt-x86_64-fftw \
  mingw-w64-ucrt-x86_64-libusb \
  mingw-w64-ucrt-x86_64-pkgconf
```

5. Verifier dans UCRT64 :

```bash
gcc --version
g++ --version
cmake --version
ninja --version
python --version
pkg-config --modversion fftw3f
pkg-config --modversion libusb-1.0
```

Dans **Parametres systeme avances > Variables d'environnement > Variables
utilisateur > Path > Modifier > Nouveau**, ajouter `C:\msys64\ucrt64\bin`
sans supprimer les entrees existantes. Creer la variable `Path` si elle
n'existe pas encore. Fermer et rouvrir les terminaux ensuite.
Ne pas utiliser `setx PATH` : sa limite de 1024 caracteres peut tronquer
le `PATH` existant.

### 3. Node.js et npm

Installer **Node.js 22 LTS, version 22.12 ou superieure**, depuis [nodejs.org](https://nodejs.org/en/download). Node.js 24+ est egalement accepte. Verifier :

```bat
node --version
npm --version
```

### 4. JDK 17

Uniquement pour construire l'application Android.

Installer un JDK 17 x64, par exemple [Microsoft Build of OpenJDK 17](https://learn.microsoft.com/java/openjdk/download). Adapter le chemin au repertoire reel, puis executer dans `cmd.exe` :

```bat
setx JAVA_HOME "C:\Program Files\Microsoft\jdk-17"
```

Ajouter ensuite `%JAVA_HOME%\bin` au `PATH` depuis **Parametres systeme avances > Variables d'environnement**, afin d'eviter les expansions incorrectes avec `setx`. Dans une nouvelle Invite de commandes :

```bat
java -version
javac -version
```

Les deux commandes doivent afficher Java 17.

### 5. Android Studio, SDK, NDK et CMake Android

SDK, NDK et CMake Android sont necessaires uniquement pour construire l'APK.
Pour installer un APK existant avec ADB, Platform-Tools suffit.

1. Installer [Android Studio](https://developer.android.com/studio).
2. Ouvrir **Tools > SDK Manager > SDK Platforms** et installer **Android API 37**.
3. Dans **SDK Tools**, activer **Show Package Details** et installer :
   - Android SDK Platform-Tools ;
   - Android SDK Build-Tools requis par le projet ;
   - Android SDK Command-line Tools (latest) ;
   - NDK (Side by side) **27.1.12297006** ;
   - CMake **3.22.1**.
4. Definir les variables, en supposant le chemin SDK standard :

```bat
setx ANDROID_HOME "%LOCALAPPDATA%\Android\Sdk"
setx ANDROID_SDK_ROOT "%LOCALAPPDATA%\Android\Sdk"
```

Ajouter ensuite ces deux entrees au `PATH` utilisateur depuis **Variables d'environnement** :

```text
%ANDROID_HOME%\platform-tools
%ANDROID_HOME%\cmdline-tools\latest\bin
```

Rouvrir `cmd.exe` puis verifier :

```bat
adb version
sdkmanager --list
```

Derriere un proxy TLS d'entreprise, utiliser si necessaire le magasin de certificats Windows :

```bat
setx JAVA_TOOL_OPTIONS "-Djavax.net.ssl.trustStoreType=Windows-ROOT"
```

### 6. Pilote RTL-SDR Windows

Pour la reception physique sous Windows, l'**interface 0** de la cle RTL-SDR
doit utiliser **WinUSB**. Si ce pilote est deja installe et que la reception
fonctionne, aucune modification n'est necessaire.

Sinon, brancher la cle puis ouvrir [Zadig](https://zadig.akeo.ie/) :

1. Choisir **Options > List All Devices**.
2. Selectionner **Bulk-In, Interface 0** de la cle RTL2832U
   (le nom peut varier ; verifier l'identifiant USB et l'interface 0).
3. Choisir **WinUSB**, puis **Install Driver** ou **Replace Driver**.

**Attention : ne pas remplacer le pilote de l'interface 1, d'un controleur
USB ou de l'interface ADB de la tablette.** Le remplacement du pilote DVB-T
de l'interface 0 peut empecher l'utilisation TV jusqu'a restauration du pilote.

Zadig n'est necessaire ni pour compiler, ni pour lire les WAV, ni pour recevoir
sur Android : l'application utilise directement la permission USB Android.

## Compilation Windows

Dans **MSYS2 UCRT64**, a la racine du depot :

```bash
cmake -S . -B build -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_PREFIX_PATH=C:/msys64/ucrt64
cmake --build build
ctest --test-dir build --output-on-failure
```

Le build produit notamment `cospas-c-api.dll`, `cospas-cli.exe` et les executables de test.

Puis, dans **cmd.exe**, a la racine du depot :

```bat
npm install
npm run ui:build
```

## Lancer l'application sous Windows

Verifier que `C:\msys64\ucrt64\bin` est dans le `PATH`, puis lancer depuis la racine du depot, dans **cmd.exe** :

```bat
npm run ui:start
```

Ouvrir <http://127.0.0.1:4173> dans Chrome ou Edge. Le serveur ecoute uniquement sur loopback. Pour changer le port :

```bat
set "SARSAT_UI_PORT=4180"
npm run ui:start
```

Le pont lance `build/cospas-cli.exe` et ne transporte aucun I/Q brut. Pour tester le moteur avant l'interface :

```bat
.\build\cospas-cli.exe --help
.\build\cospas-cli.exe devices --json
.\build\cospas-cli.exe decode --input .\samples\sgb.wav --sgb-only
```

En cas de DLL introuvable, rouvrir le terminal puis executer `where.exe libfftw3f-3.dll` et `where.exe libusb-1.0.dll`.

## Application Android

`apps/mobile` : Expo / React Native, application **SarsatSDR**,
paquet `org.adrasec.f4jrx.sarsatsdr`, minSdk 26, arm64-v8a et x86_64.
Le CLI embarque, FFTW et libusb sont lies dans `libsarsat-native.so`,
appelee par le module Expo local via JNI.

Sources : cle RTL-SDR USB OTG (permission Android et service premier plan),
captures embarquees et WAV choisi avec `OPEN WAV`.
Les captures ajoutent environ 350 Mo a l'APK ; un WAV est charge en RAM.
Le tuner attend 10 ms avant chacun des deux controles de verrouillage PLL,
notamment apres debranchement/rebranchement. Un verrouillage absent reste une erreur.

Prerequis : JDK 17, SDK Android platform 37, NDK 27.1.12297006 et CMake 3.22.1.
## Deployer l'application sur un appareil Android

### 1. Preparer la tablette

1. Dans **Parametres > A propos de la tablette**, toucher sept fois **Numero de build**.
2. Ouvrir **Options pour les developpeurs** et activer **Debogage USB**.
3. Connecter un cable USB transportant les donnees et accepter l'empreinte RSA affichee.
4. Dans `cmd.exe`, verifier la connexion :

```bat
adb kill-server
adb start-server
adb devices -l
```

L'etat doit etre `device`. S'il est `unauthorized`, deverrouiller la tablette et accepter l'autorisation. Si l'appareil est absent, installer le pilote USB du constructeur ; le Google USB Driver est disponible dans le SDK Manager pour les appareils Google.

### 2. Generer l'APK release

Depuis `cmd.exe`, a la racine du depot :

```bat
npm install
cd /d apps\mobile
npx expo prebuild -p android --no-install
cd android
gradlew.bat assembleRelease --max-workers=2
```

L'APK est genere dans :

```text
apps\mobile\android\app\build\outputs\apk\release\app-release.apk
```

### 3. Installer ou mettre a jour l'application

Depuis `apps\mobile\android` :

```bat
adb install -r app\build\outputs\apk\release\app-release.apk
```

Avec plusieurs appareils, utiliser le numero de serie retourne par `adb devices -l` :

```bat
adb -s <SERIAL> install -r app\build\outputs\apk\release\app-release.apk
```

Pour une installation propre, qui efface les donnees precedentes :

```bat
adb uninstall org.adrasec.f4jrx.sarsatsdr
adb install app\build\outputs\apk\release\app-release.apk
```

Pour diagnostiquer un crash ou un probleme USB :

```bat
adb logcat -c
adb logcat | findstr /i "SarsatSDR AndroidRuntime libusb FFTW"
```

L'APK release utilise actuellement la cle debug Expo. Configurer une vraie cle de signature avant diffusion. Les profils EAS `preview` et `production` sont fournis ; une compilation EAS sans `--local` televerse le code vers les serveurs Expo.

Sous Windows, activer LongPathsEnabled et utiliser Ninja >= 1.12 si necessaire.
Derriere un proxy TLS d'entreprise, le magasin de certificats Windows peut etre
utilise avec `JAVA_TOOL_OPTIONS=-Djavax.net.ssl.trustStoreType=Windows-ROOT`.
L'APK release utilise actuellement la cle debug Expo : definir une vraie cle
avant diffusion. Les profils EAS `preview` et `production` sont fournis ;
une compilation EAS sans `--local` televerse le code vers les serveurs Expo.

## Utilisation

Le bouton du bandeau, a droite de RECEIVING / STOPPED, ouvre la cle
(triangle vert) ou arrete la session (carre rouge). L'arret attend la fermeture USB et le vidage DSP avant
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
| WF Auto / calibration RTL | actif / 0 dB |

La limite SGB de rejet est distincte de la capacite mathematique de six corrections.
`Show invalid / over-limit BCH` conserve explicitement les echecs et affiche
`OVER LIMIT` si necessaire ; ce mode ne constitue pas une validation des trames.
Le Search Depth est affiche suivant l'echelle `position * 1,2 / 9` kHz.

La FFT utilise une demi-fenetre Blackman doublee, la reponse des deux FIR
et le maximum des bins par pixel. En RTL, le niveau tient compte du preset de
gain actif, y compris sous FE_AGC. `RTL calibration · dB` dans Settings ajoute
une correction a la FFT, aux marqueurs et a Full BW, sans modifier le decodeur.
Pour l'etalonner, entrer niveau RF connu moins niveau affiche ; la correction
est propre a la cle et n'est pas encore sauvegardee. Sans source etalon, les
dBm sont des estimations. Les WAV restent relatifs, sans mesure Full BW en dBm.
Full BW integre l'energie FFT sur les 115,2 kHz du recepteur, avec correction
de fenetre et de gain ; ce n'est pas la somme des maxima affiches.

WF Auto, actif par defaut, estime le bruit dans la partie centrale du spectre :
quartile bas et montee limitee a 0,2 dB/s pour ne pas suivre les trames courtes.
Le bruit reste noir/violet ; chaque couleur ajoute 3 dB, soit 18 dB jusqu'au
rouge. La calibration RF ne change pas ce contraste relatif.
Desactiver WF Auto reactive Base/Range, dont les valeurs sont conservees.
En manuel, la couleur est `Round((Round(niveau) + 180) * (100 - Range) / 600 - Base / 10)`,
saturee entre 0 et 6, arrondi au pair. Augmenter Base assombrit le fond ;
augmenter Range diminue le contraste. Reglages et calibration recolorent aussi l'historique.
Les points FFT indiquent des essais FGB avant BCH, pas des trames validees.

Receiver regroupe le spectre et ses controles, puis la barre de reglage,
les readouts et les metriques d'acquisition.
Dans Player, le spectre sans controles precede le bloc de lecture.
Choisir une capture puis `PLAY`. Le profil valide, actif par
defaut, applique DC, prechauffage et PLL selon `samples/playback-profiles.json`,
sans changer les reglages de reception radio. Le mode manuel utilise Settings.
Le retrait DC n'est jamais implicite ; `dcRemovalApplied` l'indique dans le JSON.
Le prechauffage repete les 200 premieres millisecondes du WAV, qui peuvent deja
contenir une porteuse. Les temps publies excluent ce prefixe.

Frames reserve davantage de largeur au detail, avec tous les champs regroupes
par section. Le detail defile independamment du tableau si necessaire.
Ouvrir Signal pour voir les traces FGB ou SGB. Les deux tableaux affichent
l'horodatage local de reception ; le temps source reste disponible dans le detail.
Chaque nouvelle trame est selectionnee automatiquement. Un changement de selection
ramene la ligne correspondante dans la zone visible du tableau.
MAP utilise la selection localisee
ou la derniere trame contenant une position.

## Mode headless

```bat
.\build\cospas-cli.exe --help
.\build\cospas-cli.exe devices --json
.\build\cospas-cli.exe decode --input .\samples\sgb.wav --sgb-only
.\build\cospas-cli.exe decode --input .\samples\sgb-cnes.wav --sgb-only --remove-dc
.\build\cospas-cli.exe decode --input .\samples\fgb.wav --fgb-only --noise-preroll-ms 2000
.\build\cospas-cli.exe decode --input .\samples\sgb.wav --sgb-only --block-samples 4093 --worker-queue 2
.\build\cospas-cli.exe receive --frequency-hz 406050000 --gain-index 8 --agc --seconds 5 --json
```

Sorties : `0` avec trame, `2` sans trame, `1` sur erreur. `devices` et
`rtl-probe` retournent `0` pour une operation reussie, meme sans cle detectee.
Le JSON de trame contient bits bruts/corriges, BCH et nombres de corrections,
`headerErrors`, temps, decalage frequentiel et `fields: [{section, name, value}]`.
`tablesSha256` identifie les tables DSP integrees ; les spectres JSONL portent
`displayOffsetDb`, et la reception expose `dspOffsetHz`.

Le centre decode est distinct du centre tuner : decalage DSP par defaut -70 kHz,
NCO apres le FIR55 et avant le FIR104, avec compensation de l'erreur PLL.
`--events` active JSONL : session, spectrum, acquisition, metrics, frame et complete.
`spectrum.fullBandwidthDbm` est une estimation RTL avant correction utilisateur,
ou `null` en lecture WAV et en l'absence d'energie mesurable.
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

```bat
ctest --test-dir build --output-on-failure
ctest --test-dir build -L samples --output-on-failure
ctest --test-dir build -L rtl --output-on-failure
npm run ui:test
npm run ui:build
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
integrations iOS et sources reseau/SigMF restent a completer.
Les WAV sont encore charges en entier ; la reception USB utilise des files bornees.
Les regressions sur captures ne remplacent pas des mesures RF de sensibilite,
de faux positifs et d'endurance.

## Licence
 
Ce projet est distribué sous la licence GNU General Public License
version 3.0 ou ultérieure (`GPL-3.0-or-later`).

L’application Android lie statiquement FFTW et constitue par conséquent
un ensemble distribué sous GNU GPL version 3 ou ultérieure.

Les composants tiers restent soumis à leurs licences respectives,
notamment libusb sous LGPL-2.1-or-later, Lucide sous ISC/MIT et
Leaflet sous BSD-2-Clause.
 
Consultez le fichier [LICENSE](LICENSE) pour le texte complet.
 
Les composants tiers conservent leurs licences respectives.
Consultez [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
