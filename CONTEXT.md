# SarsatSDR - contexte architectural

Objectifs et architecture cible du projet `sarsat-sdr`. L'etat effectivement implemente, les commandes de compilation et les limites sont decrits dans [README.md](README.md).

## 1. Objectifs

Le projet doit permettre de :

- recevoir un flux I/Q depuis une clé RTL-SDR ou une source réseau ;
- détecter en temps réel les émissions Cospas-Sarsat autour de 406 MHz ;
- démoduler et décoder les messages FGB et SGB ;
- vérifier et corriger les données selon les mécanismes FEC/BCH applicables ;
- interpréter les champs métier des messages ;
- afficher le spectre, le waterfall, l'état du récepteur et les détections ;
- enregistrer l'historique des messages et les diagnostics ;
- relire des captures I/Q pour le développement, les tests et les démonstrations ;
- reproduire exactement les traitements sur Android, iOS/iPadOS et Windows ;
- fournir des outils Windows de validation pour la mise au point du moteur DSP.

## 2. Cibles et priorités

### 2.1 Cibles principales

1. **Tablettes Android**
   - acquisition USB directe depuis une clé RTL-SDR via USB OTG ;
   - acquisition depuis une passerelle SDR réseau ;
   - relecture de fichiers I/Q.

2. **iPadOS/iOS**
   - acquisition depuis une passerelle SDR réseau ;
   - relecture de fichiers I/Q ;
   - l'accès USB direct n'appartient pas au MVP.

### 2.2 Cible secondaire

3. **Windows 10/11 x64**
   - outil de développement et de validation ;
   - acquisition RTL-SDR native ;
   - lecture de captures ;
   - CLI de validation ;
   - interface React web de diagnostic connectée au processus natif local.

Windows n'est pas, dans un premier temps, une troisième application produit complète. Une application React Native Windows ou un mode WebUSB pourra être évalué ultérieurement, sans modifier le moteur partagé.

## 3. Architecture retenue

```text
                           TABLETTES
┌──────────────────────────────────────────────────────────┐
│                 React Native / TypeScript                 │
│                                                          │
│ Navigation, configuration, historique, carte, alertes    │
├──────────────────────────────────────────────────────────┤
│            TurboModule / JSI / React Native Codegen      │
├──────────────────────────────────────────────────────────┤
│                   API C stable du moteur                  │
├──────────────────────────────────────────────────────────┤
│                  Moteur C++20 partagé                     │
│                                                          │
│ Acquisition → DSP → FGB/SGB → FEC/BCH → événements       │
├────────────────────────────┬─────────────────────────────┤
│ Android                    │ iOS/iPadOS                  │
│ USB RTL-SDR                │ Source réseau              │
│ Source réseau              │ Source fichier             │
│ Source fichier             │                            │
└────────────────────────────┴─────────────────────────────┘
                 ▲                         ▲
                 └──────── flux I/Q ───────┘
                           │
                 ┌─────────▼─────────┐
                 │ Passerelle SDR    │
                 │ Linux/Raspberry Pi│
                 │ RTL-SDR + réseau  │
                 └───────────────────┘

                     OUTILS WINDOWS
┌──────────────────────────────────────────────────────────┐
│ React web de diagnostic ← WebSocket local → serveur/CLI  │
│                                      │                   │
│                             même moteur C++20            │
│                                      │                   │
│                     RTL-SDR natif ou fichier I/Q         │
└──────────────────────────────────────────────────────────┘
```

### 3.1 Principe structurant

Le projet est organisé en quatre couches strictement séparées :

1. **Acquisition I/Q** : dépendante de la plateforme ou du transport.
2. **DSP et décodage** : C++ portable, indépendant de l'UI et de la plateforme.
3. **Logique produit** : TypeScript partagé autant que raisonnablement possible.
4. **Présentation** : React Native sur tablette et React web pour le diagnostic Windows.

La couche UI ne doit jamais recevoir le flux I/Q brut à pleine cadence.

## 4. Choix technologiques

| Domaine | Choix principal |
|---|---|
| Application tablette | React Native, nouvelle architecture activée |
| Langage UI et logique produit | TypeScript en mode strict |
| Liaison React Native/native | TurboModules, JSI et Codegen |
| DSP et décodage | C++20 |
| Build natif | CMake |
| Android natif | Kotlin mince + Android NDK |
| iOS natif | Objective-C++/Swift mince si nécessaire |
| SDR Android/Windows | `librtlsdr` et `libusb`/WinUSB selon la plateforme |
| Transport réseau initial | TCP pour les échantillons, WebSocket pour le contrôle |
| Captures de test | SigMF |
| Tests C++ | GoogleTest ou Catch2, à figer une fois pour le dépôt |
| UI mobile de spectre/waterfall | rendu GPU, de préférence React Native Skia |
| Outil Windows | CLI/serveur C++ + React web |
| Gestion monorepo JavaScript | pnpm workspaces |

Ne pas introduire une technologie concurrente sans justification architecturale documentée dans une ADR.

## 5. Structure recommandée du dépôt

```text
cospas-sarsat-sdr/
├── README.md
├── LICENSE
├── CMakeLists.txt
├── pnpm-workspace.yaml
├── package.json
├── apps/
│   ├── mobile/                         # React Native Android/iOS
│   │   ├── android/
│   │   ├── ios/
│   │   └── src/
│   └── diagnostic-web/                 # React web pour Windows/dev
├── packages/
│   ├── domain-types/                   # Types métier TypeScript partagés
│   ├── protocol/                       # Protocole de la passerelle
│   ├── react-components/               # Composants partageables web/mobile
│   └── native-cospas-module/           # Spec Codegen et bindings RN
├── native/
│   ├── cospas-core/                    # Moteur DSP indépendant
│   ├── sources/
│   │   ├── rtl-android/
│   │   ├── rtl-windows/
│   │   ├── network/
│   │   ├── sigmf/
│   │   └── synthetic/
│   ├── cospas-cli/                     # CLI et serveur local Windows
│   └── tests/
├── gateway/                            # Service de passerelle Linux/RPi
├── testdata/
│   ├── fgb/
│   ├── sgb/
│   ├── interference/
│   ├── noise/
│   └── expected/
├── docs/
│   ├── adr/                            # Architecture Decision Records
│   ├── protocols/
│   └── validation/
└── tools/
```

La structure pourra évoluer, mais les frontières entre UI, bindings, moteur, sources et données de test doivent rester explicites.

## 6. Moteur C++ partagé

`native/cospas-core` contient toute la chaîne de traitement déterministe et testable. Il ne doit dépendre ni de React Native, ni de Kotlin, ni de Swift, ni d'une API USB particulière.

### 6.1 Pipeline DSP

```text
Échantillons I/Q intercalés
        ↓
Conversion/normalisation du format d'entrée
        ↓
Suppression de la composante continue
        ↓
Correction optionnelle du déséquilibre I/Q
        ↓
Translation fréquentielle complexe
        ↓
Filtrage du canal et décimation
        ↓
Détection d'énergie et de burst
        ↓
Estimation/correction de fréquence
        ↓
        ├── Chaîne FGB
        └── Chaîne SGB
        ↓
Récupération de porteuse, horloge et trame
        ↓
FEC/BCH et contrôle d'intégrité
        ↓
Interprétation du message
        ↓
Événement de décodage normalisé
```

Les chaînes FGB et SGB sont distinctes. Le code commun doit être factorisé uniquement lorsqu'il représente réellement le même traitement ou le même concept.

### 6.2 Règles du moteur

- Aucun appel à une API d'interface graphique.
- Aucune dépendance à React Native ou à un runtime JavaScript.
- Aucune allocation dynamique dans la boucle critique après initialisation.
- Aucun verrou bloquant dans le callback d'acquisition.
- Aucun accès disque, réseau ou log verbeux dans le chemin temps réel.
- Utiliser des buffers préalloués et des files SPSC lorsque la topologie est mono-producteur/mono-consommateur.
- Employer une horloge monotone pour les temps internes.
- Conserver les métadonnées de fréquence, de taux d'échantillonnage et d'horodatage avec chaque séquence de données.
- Les erreurs sont retournées explicitement, jamais ignorées.
- Les algorithmes doivent disposer d'une implémentation scalaire validée avant optimisation SIMD.
- Les optimisations SIMD peuvent cibler ARM NEON et x86-64 AVX2, avec repli scalaire.
- Toute optimisation doit être couverte par les mêmes tests que la version scalaire validée.

### 6.3 Formats I/Q

Le moteur doit au minimum accepter :

- `CU8` : I et Q non signés sur 8 bits, intercalés ;
- `CS16` : I et Q signés sur 16 bits, intercalés ;
- `CF32` : I et Q en `float`, intercalés.

Le format interne doit être choisi sur la base de mesures. Ne pas convertir systématiquement en objets complexes individuels et ne pas créer un objet par échantillon.

### 6.4 API stable

Le moteur expose une API C stable devant l'implémentation C++. Cette façade est utilisée par React Native, la CLI, la passerelle, les tests d'intégration et une éventuelle compilation WebAssembly.

Exemple indicatif :

```c
typedef struct cs_engine cs_engine;

typedef struct {
    uint32_t sample_rate_hz;
    uint64_t center_frequency_hz;
    uint32_t ring_buffer_samples;
    uint8_t enable_fgb;
    uint8_t enable_sgb;
} cs_engine_config;

cs_engine* cs_engine_create(const cs_engine_config* config);
int cs_engine_start(cs_engine* engine);
void cs_engine_stop(cs_engine* engine);
void cs_engine_destroy(cs_engine* engine);

size_t cs_engine_push_iq_u8(
    cs_engine* engine,
    const uint8_t* iq_interleaved,
    size_t complex_sample_count
);

int cs_engine_poll_event(cs_engine* engine, cs_event* output);
```

L'exemple ne constitue pas encore une ABI figée. Toute modification d'une API publique doit être documentée et testée.

## 7. Abstraction des sources I/Q

Toutes les entrées implémentent le même contrat conceptuel :

```cpp
class IqSource {
public:
    virtual ~IqSource() = default;
    virtual Result open(const SourceConfig& config) = 0;
    virtual Result start(IqSink& sink) = 0;
    virtual void stop() = 0;
    virtual SourceStatistics statistics() const = 0;
};
```

Sources prévues :

- `RtlUsbAndroidSource` ;
- `RtlUsbWindowsSource` ;
- `NetworkIqSource` ;
- `SigMfFileSource` ;
- `SyntheticIqSource`.

Une source pousse des blocs horodatés vers un `IqSink`. Elle ne connaît ni le décodeur, ni l'UI.

## 8. Application React Native

React Native gère l'expérience utilisateur et la logique produit, mais pas le DSP à pleine cadence.

### 8.1 Responsabilités TypeScript

- navigation et états d'écran ;
- sélection et configuration de la source ;
- démarrage et arrêt d'une session ;
- réglages de fréquence, gain et taux d'échantillonnage ;
- affichage du statut et des diagnostics synthétiques ;
- historique des détections ;
- règles d'alerte ;
- cartes et présentation des positions ;
- persistance des préférences et résultats ;
- exports utilisateur ;
- gestion des erreurs présentables à l'utilisateur.

### 8.2 Interdictions côté JavaScript

Ne jamais faire transiter par le runtime JavaScript :

- le flux I/Q brut continu ;
- un événement par paquet USB ;
- les buffers intermédiaires du DSP ;
- une FFT à la cadence d'acquisition ;
- les données de corrélation complètes en fonctionnement normal.

Ne jamais placer des échantillons I/Q dans un state React, Redux, Zustand ou un mécanisme équivalent.

### 8.3 Contrat du module natif

Le TurboModule expose seulement :

- les commandes de session ;
- la configuration de la source et du récepteur ;
- l'état synthétique ;
- les messages décodés ;
- les erreurs ;
- des statistiques limitées en fréquence ;
- un spectre ou une ligne de waterfall déjà réduit.

Fréquences indicatives maximales :

| Donnée | Fréquence cible |
|---|---:|
| État du récepteur | 2 à 5 Hz |
| Statistiques | 2 à 5 Hz |
| Spectre | 10 à 15 Hz |
| Waterfall | 10 à 20 lignes/s |
| Détection | immédiatement, une fois par événement |

### 8.4 Modèle d'événement

Un événement de détection doit au minimum véhiculer :

```typescript
type DecodedBeaconEvent = {
  id: string;
  generation: 1 | 2;
  timestampMs: number;
  rawHex: string;
  beaconId?: string;
  latitude?: number;
  longitude?: number;
  snrDb?: number;
  frequencyOffsetHz?: number;
  correctedErrors: number;
  integrity: 'valid' | 'corrected' | 'invalid';
};
```

Les types réellement utilisés doivent être générés ou alignés depuis une source de vérité commune afin d'éviter les divergences entre TypeScript et C/C++.

## 9. Android

Android prend en charge trois sources :

1. clé RTL-SDR connectée en USB OTG ;
2. passerelle réseau ;
3. fichier I/Q/SigMF.

### 9.1 Répartition Android

**Kotlin** reste une couche mince :

- demande d'autorisation USB ;
- interaction avec `UsbManager` ;
- cycle de vie Android ;
- service de premier plan pendant une réception active ;
- notification de session ;
- wakelock limité à la session ;
- erreurs et événements système.

**C++/NDK** assure :

- acquisition `libusb`/`librtlsdr` ;
- buffers d'acquisition ;
- DSP et décodage ;
- statistiques temps réel.

Ne pas réimplémenter le DSP en Kotlin.

## 10. iOS et iPadOS

Le MVP iOS/iPadOS utilise :

- `NetworkIqSource` pour la réception en direct ;
- `SigMfFileSource` pour les tests et démonstrations.

Le branchement direct d'une clé USB RTL-SDR n'est pas une exigence du MVP. Une expérimentation DriverKit pourra être menée séparément pour des iPad compatibles, derrière l'interface `IqSource`, sans modifier le moteur ni l'application métier.

L'application doit rester fonctionnellement cohérente entre Android et iOS. Le mode réseau est donc un mode de premier rang sur les deux plateformes, pas un mode de secours réservé à iOS.

## 11. Passerelle SDR réseau

La passerelle est un service Linux, typiquement déployé sur Raspberry Pi ou un boîtier équivalent. Elle :

- pilote la clé RTL-SDR ;
- publie son identité et ses capacités ;
- accepte la configuration RF ;
- diffuse le flux I/Q ou des bursts extraits ;
- expose des statistiques et erreurs ;
- gère la reconnexion et le cycle de vie matériel.

### 11.1 Modes de transport

Le protocole doit pouvoir évoluer entre :

- `raw-iq` : flux I/Q brut pour le développement et le diagnostic ;
- `channel-iq` : canal filtré/décimé ;
- `burst-iq` : portions de signal autour des bursts détectés ;
- `decoded-events` : événements déjà décodés, à terme si le moteur tourne dans la passerelle.

Pour le MVP :

- canal de contrôle en WebSocket ;
- données I/Q sur TCP ;
- découverte locale par mDNS/Bonjour ;
- protocole binaire versionné pour les blocs I/Q.

`rtl_tcp` peut être utilisé pour un prototype, mais ne constitue pas le protocole produit final.

### 11.2 En-tête minimal d'un bloc réseau

Chaque bloc doit comporter au minimum :

- signature et version du protocole ;
- identifiant de session ;
- numéro de séquence ;
- timestamp du premier échantillon ;
- fréquence centrale ;
- taux d'échantillonnage ;
- format I/Q ;
- nombre d'échantillons ;
- indicateurs de discontinuité ;
- longueur du payload ;
- contrôle d'intégrité adapté.

Toutes les valeurs réseau ont un endianness explicitement défini.

### 11.3 Débit

À 2,4 MS/s en CU8 :

```text
2 400 000 échantillons complexes/s × 2 octets = 4,8 Mo/s
```

Soit environ 38,4 Mbit/s hors encapsulation. Le réseau cible doit fournir une marge utile significative ; les tests doivent inclure la gigue, les pertes, les déconnexions et les modes d'économie d'énergie des tablettes.

## 12. Outils Windows de développement

### 12.1 CLI de validation

`cospas-cli` est l'oracle de validation du moteur. Il doit permettre :

```text
cospas-cli decode --input capture.sigmf-meta
cospas-cli receive --device rtl --frequency 406050000 --sample-rate 2400000
cospas-cli benchmark --input testdata/
cospas-cli serve --listen 127.0.0.1:PORT
```

La syntaxe exacte sera figée dans la documentation de la CLI.

La CLI doit :

- utiliser exactement `cospas-core` ;
- produire des résultats structurés et reproductibles ;
- supporter une sortie JSON ;
- fournir des codes de sortie exploitables en CI ;
- fonctionner sans interface graphique ;
- accepter les mêmes paramètres DSP que l'application mobile.

### 12.2 Interface React web

L'interface de diagnostic se connecte au serveur local de la CLI, idéalement via WebSocket. Elle sert à afficher :

- spectre et waterfall ;
- signal temporel ;
- métriques de détection ;
- fréquence et synchronisation estimées ;
- bits et trames ;
- champs décodés ;
- résultats FEC/BCH ;
- performances et pertes de blocs ;
- comparaisons entre versions du moteur.

WebUSB/WebAssembly peut rester une expérience secondaire. Le chemin de développement de validation utilise le moteur C++ natif.

## 13. Spectre et waterfall

Le moteur ne transmet à l'UI que des données réduites :

```cpp
struct SpectrumLine {
    uint64_t timestamp_ns;
    float start_frequency_hz;
    float bin_width_hz;
    uint16_t bin_count;
    uint8_t intensity[1024];
};
```

Principes :

- 512 ou 1 024 bins suffisent pour l'affichage normal ;
- 10 à 20 lignes de waterfall par seconde ;
- rendu par texture GPU ;
- aucune vue React par bin ;
- aucune reconstruction d'une image complète pour chaque ligne ;
- palette appliquée côté rendu ;
- diagnostics haute résolution activés uniquement à la demande.

## 14. Concurrence et temps réel

Topologie de validation :

```text
Thread d'acquisition
        ↓
Ring buffer SPSC préalloué
        ↓
Thread DSP
        ↓
File d'événements SPSC
        ↓
Adaptateur React Native / serveur Windows
        ↓
UI
```

Règles :

- le thread d'acquisition ne doit jamais attendre l'UI ;
- le moteur doit signaler chaque débordement ou discontinuité ;
- les files sont bornées ;
- une politique de saturation est définie explicitement ;
- les callbacks natifs ne doivent pas conserver des pointeurs invalides ;
- l'arrêt doit être ordonné, idempotent et testable ;
- aucune exception C++ ne traverse la frontière C ou JSI ;
- la destruction attend la fin des threads natifs.

## 15. Budget de performance

Objectifs initiaux, à valider sur les appareils réels :

| Indicateur | Cible initiale |
|---|---:|
| Débit CU8 continu | 2,4 MS/s minimum |
| Blocs perdus pendant 30 min | 0 en conditions nominales |
| Allocations dans acquisition/DSP | 0 par bloc après initialisation |
| Latence fin de burst → événement | < 100 ms, objectif |
| Fréquence spectre | 10 à 15 Hz |
| Fréquence waterfall | 10 à 20 Hz |
| Croissance mémoire sur 2 h | aucune croissance non bornée |
| Ring buffer typique | 0,5 à 2 s de signal |
| Récupération après déconnexion | sans redémarrage de l'application |

Ces valeurs sont des objectifs d'ingénierie. Les critères de release seront ajustés à partir de mesures reproductibles.

## 16. Données de test et SigMF

Les captures sont stockées en SigMF :

```text
capture.sigmf-data
capture.sigmf-meta
expected.json
notes.md
```

Les gros fichiers I/Q ne doivent pas être ajoutés naïvement à Git. Utiliser Git LFS, un stockage d'artefacts ou un jeu de données versionné séparément selon la politique du dépôt.

Le corpus doit couvrir :

- FGB court et long ;
- SGB ;
- différents SNR ;
- erreurs de fréquence et dérive ;
- bursts tronqués ;
- saturation ;
- brouilleurs et canaux adjacents ;
- composante continue ;
- déséquilibre ou inversion I/Q ;
- pertes de blocs ;
- plusieurs clés SDR et appareils ;
- bruit sans signal pour mesurer les faux positifs.

Chaque capture doit documenter sa provenance, ses paramètres RF, les transformations appliquées et le résultat attendu. Ne pas inclure de données sensibles ou non redistribuables.

## 17. Stratégie de test

### 17.1 Tests unitaires

- filtres et décimateurs ;
- oscillateur/mélangeur complexe ;
- corrélateurs ;
- récupération de timing ;
- FEC/BCH ;
- parseurs FGB/SGB ;
- conversion des coordonnées ;
- sérialisation des événements ;
- parsing du protocole réseau.

### 17.2 Tests golden files

```text
Capture I/Q + configuration
            ↓
        cospas-core
            ↓
       résultats JSON
            ↓
 comparaison avec expected.json
```

Les comparaisons doivent distinguer :

- champs exacts ;
- tolérances numériques documentées ;
- événements attendus et absents ;
- faux positifs ;
- temps de traitement lorsqu'il est pertinent.

### 17.3 Tests d'intégration

- source fichier → moteur → événement ;
- source réseau → moteur → événement ;
- RTL-SDR Windows → moteur ;
- RTL-SDR Android → moteur ;
- TurboModule → application React Native ;
- reconnexion réseau et USB ;
- démarrage/arrêt répétés ;
- passage en arrière-plan selon les limites de la plateforme.

### 17.4 Tests d'endurance

- 30 minutes en développement ;
- 2 heures avant release candidate ;
- 8 heures pour la validation opérationnelle.

Mesurer CPU, mémoire, température, throttling, énergie, blocs perdus, profondeur des files, latence et reconnexions.

## 18. Observabilité

Le moteur maintient des compteurs structurés :

- échantillons reçus ;
- blocs reçus/perdus ;
- discontinuités ;
- remplissage maximal du ring buffer ;
- bursts candidats ;
- bursts rejetés ;
- décodages valides/corrigés/invalides ;
- temps CPU par étage ;
- latence de traitement ;
- fréquence et SNR estimés.

La journalisation ne doit jamais exposer inutilement des données personnelles encodées dans une balise. Les logs de production sont limités, structurés et configurables. Les traces DSP détaillées sont réservées au mode diagnostic.

## 19. Sécurité et confidentialité

- L'utilisateur doit explicitement choisir et autoriser une source.
- Les connexions distantes doivent être authentifiées et chiffrées dans la version produit.
- La passerelle ne doit pas écouter sur une interface publique par défaut.
- Le serveur Windows de diagnostic écoute sur `127.0.0.1` par défaut.
- Toute ouverture réseau doit avoir des limites de taille, de débit et de temps.
- Les données réseau sont validées avant utilisation.
- Les longueurs, offsets et compteurs sont contrôlés contre les dépassements.
- Ne jamais faire confiance aux métadonnées d'un fichier SigMF ou d'une passerelle.
- Les exports contenant des identifiants ou positions de balises doivent être traités comme des données sensibles.
- Aucun secret ne doit être commité dans le dépôt.

## 20. Règles de développement

### 20.1 C++

- C++20, RAII et ownership explicite.
- Préférer `std::span`, `std::array`, `std::vector` préalloué et les types valeur.
- Éviter `new`/`delete` explicites dans le code applicatif.
- Pas d'exception à travers les frontières ABI.
- Pas de singleton global pour le moteur.
- Pas d'état mutable partagé sans synchronisation documentée.
- Les unités doivent apparaître dans les noms : `_hz`, `_ms`, `_samples`, `_db`.
- Distinguer nombre d'échantillons complexes et nombre de scalaires I/Q.
- Vérifier les tailles avant toute lecture de buffer.
- Chaque nouvel algorithme DSP doit avoir des tests numériques.

### 20.2 TypeScript/React

- TypeScript strict ; éviter `any`.
- Composants fonctionnels et hooks.
- Séparer état UI, logique métier et accès infrastructure.
- Ne pas dupliquer en TypeScript les parseurs/décodeurs du moteur.
- Ne pas déclencher un rendu React à chaque bloc ou ligne si une vue GPU peut être mise à jour directement.
- Toute souscription native doit être désinscrite au démontage.
- Les erreurs natives sont converties en erreurs métier typées.
- Préférer des états finis explicites pour une session : `idle`, `connecting`, `running`, `stopping`, `error`.

### 20.3 React Native/native

- Utiliser la nouvelle architecture React Native.
- Utiliser Codegen pour le contrat du module natif.
- Les callbacks et promesses ne doivent pas être invoqués après destruction du runtime.
- Ne jamais bloquer le thread JavaScript avec une opération native longue.
- Les opérations longues s'exécutent sur des threads natifs contrôlés par le moteur.
- Limiter la quantité et la fréquence des données traversant JSI.

## 21. Conventions de qualité

Toute contribution doit idéalement passer :

- formatage C++ (`clang-format`) ;
- analyse statique (`clang-tidy`) ;
- compilation avec warnings élevés ;
- tests C++ ;
- lint TypeScript/React ;
- vérification des types ;
- tests JavaScript/TypeScript ;
- golden tests sur un corpus réduit ;
- build Android ;
- build iOS sur un runner macOS lorsque disponible ;
- build Windows de la CLI.

Les noms exacts des commandes seront ajoutés lorsque les outils de build auront été initialisés.

## 22. Principes pour GitHub Copilot et les contributions assistées

Lorsqu'un assistant génère ou modifie du code dans ce dépôt, il doit :

1. respecter les frontières entre UI, bindings, acquisition et moteur ;
2. ne jamais déplacer le DSP à pleine cadence vers TypeScript, Kotlin ou Swift ;
3. réutiliser `cospas-core` au lieu de dupliquer les algorithmes ;
4. conserver l'indépendance du moteur vis-à-vis des frameworks UI ;
5. utiliser les abstractions `IqSource` et `IqSink` pour toute nouvelle source ;
6. éviter les allocations, logs et verrous dans le chemin critique ;
7. ajouter ou mettre à jour les tests pour toute modification algorithmique ;
8. traiter les tailles, formats, unités et endianness explicitement ;
9. ne pas inventer de paramètres du standard Cospas-Sarsat ;
10. signaler par un `TODO` documenté toute valeur provisoire nécessitant une vérification normative ;
11. ne pas créer de protocole ad hoc non versionné ;
12. préserver la compatibilité Android/iOS/Windows du cœur C++ ;
13. proposer une ADR lorsqu'une modification change une décision structurante ;
14. ne pas inclure de capture réelle, de clé ou de donnée sensible dans le code ou les tests ;
15. favoriser du code simple, mesurable et explicite plutôt qu'une abstraction prématurée.

## 23. Hypothèses actuelles

- Taux d'échantillonnage nominal de départ : jusqu'à 2,4 MS/s pour une clé RTL-SDR.
- Format initial privilégié : CU8.
- Fréquence de travail autour de la bande Cospas-Sarsat 406 MHz, configurable.
- Le moteur doit décoder FGB et SGB, mais leur développement peut être phasé.
- Android offre USB direct et réseau.
- iOS/iPadOS utilise le réseau dans le MVP.
- Windows sert en priorité à la validation et à la mise au point.
- Le moteur est compilable nativement sur ARM64 et x86-64.
- La conformité exacte aux spécifications applicables doit être vérifiée à partir des documents normatifs Cospas-Sarsat détenus ou accessibles par le projet.

## 24. Hors périmètre initial

- remplacement d'une infrastructure officielle de réception d'alertes ;
- localisation satellitaire indépendante d'une balise ne transmettant pas sa position ;
- support de tous les matériels SDR dès le MVP ;
- application Windows produit complète ;
- accès USB direct RTL-SDR sur tous les appareils iOS ;
- traitement cloud obligatoire ;
- émission radio ou génération d'un signal de détresse sur RF ;
- entraînement d'un modèle d'apprentissage automatique sur les signaux.

> [!WARNING]
> Le projet ne doit pas inclure de fonction permettant d'émettre une fausse alerte de détresse sur la bande 406 MHz. Les signaux synthétiques sont réservés aux tests numériques hors RF ou à des environnements de laboratoire autorisés et protégés.

## 25. Roadmap indicative

### Phase 1 — Socle DSP et Windows

- structure du monorepo ;
- façade C ;
- source SigMF ;
- source RTL-SDR Windows ;
- CLI ;
- corpus initial ;
- première chaîne FGB ;
- interface web de diagnostic minimale.

### Phase 2 — Android

- TurboModule/JSI ;
- application React Native ;
- acquisition USB Android ;
- spectre et waterfall ;
- historique et exports ;
- endurance et thermique.

### Phase 3 — Réseau et iPad

- passerelle Linux/Raspberry Pi ;
- protocole réseau versionné ;
- découverte mDNS ;
- `NetworkIqSource` ;
- application iPad ;
- reconnexion et sécurisation.

### Phase 4 — SGB et industrialisation

- chaîne SGB complète ;
- optimisation ARM NEON et AVX2 ;
- validation multi-matériel ;
- métriques et diagnostics ;
- mode burst réseau ;
- packaging, signature et diffusion.

## 26. Décisions à documenter par ADR

Les premiers ADR devraient couvrir :

- séparation React Native/C++ ;
- API C stable devant le moteur C++ ;
- source réseau comme parcours principal iOS ;
- TCP initial pour l'I/Q ;
- SigMF pour les captures ;
- CLI native comme oracle Windows ;
- stratégie de rendu du waterfall ;
- choix du framework de tests C++ ;
- format exact des événements et du protocole réseau ;
- politique de licence de `librtlsdr`, `libusb` et des autres dépendances.

## 27. Licence et dépendances

La licence du projet reste à définir. Avant toute distribution, vérifier la compatibilité des licences de toutes les dépendances natives et JavaScript, notamment pour :

- `librtlsdr` ;
- `libusb` ;
- React Native ;
- React Native Skia si retenu ;
- le framework de tests ;
- les bibliothèques DSP éventuelles ;
- les composants cartographiques.

Aucune dépendance ne doit être ajoutée uniquement pour une fonction simple pouvant être implémentée de manière claire et testable dans le projet.

## 28. État du projet

Le projet est actuellement en phase de conception initiale. Les interfaces de ce README décrivent la cible architecturale ; elles ne constituent pas toutes des API déjà implémentées ou figées.

Lors de l'initialisation du dépôt, compléter en priorité :

- prérequis et versions d'outils ;
- commandes de build ;
- commandes de test ;
- configuration des appareils Android/iOS ;
- installation du pilote RTL-SDR sous Windows ;
- lancement de la passerelle ;
- exemples de captures et résultats attendus ;
- politique de contribution et de sécurité.
