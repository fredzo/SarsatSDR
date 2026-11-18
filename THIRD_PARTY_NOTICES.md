# Third-Party Notices

This project includes or depends on third-party software components. Those components remain the property of their respective copyright holders and are provided under their own license terms.

The license of this project does not replace, modify, or supersede the licenses of third-party components.

> **Distribution note:** Before publishing a binary release, update this file from the exact dependency lockfiles and native build manifests used for that release. Include every component that is copied into, statically linked with, dynamically linked with, or otherwise distributed alongside the application.

## 1. FFTW 3.3.10

- **Component:** FFTW, the Fastest Fourier Transform in the West
- **Version:** 3.3.10
- **Project:** https://www.fftw.org/
- **License:** GNU General Public License, version 2 or, at your option, any later version (`GPL-2.0-or-later`)
- **Copyright:** Copyright © 2003, 2007–2011 Matteo Frigo; Copyright © 2003, 2007–2011 Massachusetts Institute of Technology
- **Use in this project:** Fast Fourier Transform operations used by the native DSP engine
- **Modifications:** None, unless otherwise documented in the source tree or release notes
- **Source code:** https://www.fftw.org/download.html
- **License information:** https://www.fftw.org/doc/License-and-Copyright.html

FFTW is free software: it may be redistributed and/or modified under the terms of the GNU General Public License as published by the Free Software Foundation, either version 2 of the License or, at the recipient's option, any later version.

FFTW is distributed in the hope that it will be useful, but **WITHOUT ANY WARRANTY**, including without the implied warranties of **MERCHANTABILITY** or **FITNESS FOR A PARTICULAR PURPOSE**.

The complete license text applicable to FFTW must be distributed with binary releases. It may be stored, for example, at:

```text
LICENSES/GPL-2.0-or-later.txt
```

Because the distributed application links with FFTW, the project's corresponding source code and build instructions must be made available under GPL-compatible terms as required by the GNU GPL.

The FFTW authors request, but do not require, acknowledgment of FFTW in programs and publications. Their suggested academic reference is:

> Matteo Frigo and Steven G. Johnson, “The Design and Implementation of FFTW3,” *Proceedings of the IEEE*, volume 93, number 2, pages 216–231, 2005.

## 2. libusb 1.0.30

- **Component:** libusb
- **Version:** 1.0.30
- **Project:** https://libusb.info/
- **Source repository:** https://github.com/libusb/libusb
- **License:** GNU Lesser General Public License, version 2.1 or, at your option, any later version (`LGPL-2.1-or-later`)
- **Use in this project:** Cross-platform access to supported USB devices, including the native RTL-SDR acquisition path
- **Modifications:** None, unless otherwise documented in the source tree or release notes
- **Official release source:** https://github.com/libusb/libusb/releases/tag/v1.0.30

libusb is distributed under the GNU Lesser General Public License. It is provided **WITHOUT ANY WARRANTY**, including without the implied warranties of **MERCHANTABILITY** or **FITNESS FOR A PARTICULAR PURPOSE**.

The complete license text applicable to libusb must be distributed with binary releases. It may be stored, for example, at:

```text
LICENSES/LGPL-2.1-or-later.txt
```

When distributing libusb with this application, the release must preserve the notices required by the LGPL and provide access to the corresponding libusb source code, including the source code of any modifications made by this project.

If libusb is statically linked, the release process must also preserve the user's ability to modify or replace the LGPL-covered library as required by the LGPL. The exact compliance mechanism must be documented for each platform and distribution channel.

## 3. Lucide

- **Component:** Lucide icon toolkit (use the exact package name and version from the lockfile, for example `lucide-react` or `lucide-react-native`)
- **Project:** https://lucide.dev/
- **Source repository:** https://github.com/lucide-icons/lucide
- **License:** ISC License (`ISC`)
- **Copyright:** Copyright © 2026 Lucide Icons and Contributors, subject to the copyright notice shipped with the exact installed version
- **Use in this project:** User-interface icons
- **Modifications:** None, unless otherwise documented in the source tree or release notes

The Lucide copyright notice, permission notice, and warranty disclaimer must be retained in copies. Some Lucide icons are derived from the Feather project and are separately covered by the MIT License, with copyright held by Cole Bemis. The full upstream Lucide license file, including the list of Feather-derived icons and their MIT notice, must therefore be preserved unmodified with distributed releases.

Store the exact license file from the installed Lucide package at, for example:

```text
LICENSES/Lucide-ISC-and-Feather-MIT.txt
```

## 4. Leaflet

- **Component:** Leaflet
- **Version:** Use the exact version from the package-manager lockfile
- **Project:** https://leafletjs.com/
- **Source repository:** https://github.com/Leaflet/Leaflet
- **License:** BSD 2-Clause “Simplified” License (`BSD-2-Clause`)
- **Copyright:** Copyright © 2010–2026 Volodymyr Agafonkin; Copyright © 2010–2011 CloudMade, subject to the copyright notice shipped with the exact installed version
- **Use in this project:** Interactive maps in the diagnostic web application
- **Modifications:** None, unless otherwise documented in the source tree or release notes

Source redistributions must retain Leaflet's copyright notice, license conditions, and disclaimer. Binary redistributions must reproduce those elements in the documentation and/or other materials supplied with the distribution.

Store the exact license text from the installed Leaflet package at, for example:

```text
LICENSES/Leaflet-BSD-2-Clause.txt
```

## 5. Additional dependencies

This file currently records the dependencies explicitly confirmed for the project: FFTW 3.3.10, libusb 1.0.30, Lucide, and Leaflet. The exact Lucide and Leaflet package versions must be copied from the release lockfile before distribution.

The project is expected to use additional third-party components, including software from the React Native, Android, Apple, Windows, CMake, testing, networking, SDR, and JavaScript ecosystems. They must not be considered covered by the two notices above.

Before each release, generate and review a complete dependency inventory from at least:

- `package.json` and the package-manager lockfile;
- Gradle dependency reports;
- CocoaPods `Podfile.lock` or Swift Package Manager resolution files;
- CMake manifests and fetched native dependencies;
- Windows package manifests, including vcpkg or NuGet where applicable;
- Linux gateway package manifests;
- all bundled fonts, icons, maps, sample captures, and other assets.

For each distributed component, record:

1. component name and exact version or commit;
2. upstream project URL;
3. copyright notice;
4. SPDX license identifier;
5. whether the component is modified;
6. how it is linked or packaged;
7. where its complete license text is stored;
8. where the corresponding source is available when required.

## 6. Suggested repository layout

```text
LICENSE
THIRD_PARTY_NOTICES.md
LICENSES/
├── GPL-2.0-or-later.txt
├── GPL-3.0.txt
├── LGPL-2.1-or-later.txt
├── Lucide-ISC-and-Feather-MIT.txt
└── Leaflet-BSD-2-Clause.txt
```

The root `LICENSE` file covers the project's original code. Files under `LICENSES/` contain the complete license texts for the project and redistributed third-party components.

## 7. No endorsement

The names of third-party projects and copyright holders are used only to identify the components and their applicable license terms. Their inclusion does not imply endorsement of this project by those projects or copyright holders.

## 8. Reporting an omission

If you believe a third-party component or notice is missing or incorrect, open an issue in the project repository and include:

- the component name and version;
- the file or build artifact in which it appears;
- the upstream source URL;
- the applicable license and copyright notice.
