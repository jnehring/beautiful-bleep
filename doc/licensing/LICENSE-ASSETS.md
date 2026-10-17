# Bleep Patch Asset Licence

This file covers non-code assets in the Bleep Patch repository and
releases. Source code is covered by the GPL-3.0 with Module Exception
(see LICENSE and LICENSE-EXCEPTION.md). Where a file is not clearly
covered here, the code licence applies only to code, and all rights in the
asset are reserved.

## 1. Brand assets: all rights reserved

Applies to: the Bleep Patch name, logo, icon, wordmark and splash/marketing
images, in `assets/brand/`.

No licence is granted except the limited uses in TRADEMARK.md. Forks must
remove these assets and replace them with their own.

## 2. Core visual design: CC BY-NC-ND 4.0

Applies to: the visual design of the core application and its built-in
modules (panels, skins, themes, layout art), in `assets/core-design/`.

Licensed under Creative Commons Attribution-NonCommercial-NoDerivatives 4.0
International (https://creativecommons.org/licenses/by-nc-nd/4.0/).

You may share unmodified copies with credit for non-commercial purposes.
You may not use them commercially or distribute modified versions. Forks
that modify the core must replace these assets.

## 3. SDK assets: CC BY 4.0, commercial use allowed

Applies to: the component library and helper graphics intended for module
developers (knobs, buttons, jacks, icons, fonts bundled for modules), in
`sdk/assets/`.

Licensed under Creative Commons Attribution 4.0 International
(https://creativecommons.org/licenses/by/4.0/).

Module developers may use, modify and redistribute these assets in modules,
**including closed-source and paid modules**, with or without the store,
provided they give credit (a line in the module's about page or
documentation is enough). Using these assets does not subject a module to
the GPL.

## 4. Third-party assets

Fonts, sounds and images from other authors keep their own licences,
listed in `assets/THIRD-PARTY.md`. Check them before redistributing.

## 5. Contributions

Contributed assets are placed in the category the maintainers assign them
to, under that category's licence. The CLA (or DCO) covers this.

## Notes for the maintainer (delete before publishing)

- Create the directories above and sort every existing asset into one
  category. Anything left unsorted defaults to "all rights reserved".
- CC licences are not recommended for software, but are standard for
  artwork. Do not use CC for the code.
- CC BY-NC-ND is not OSI "open source"; it applies only to the core
  design, not to anything modules need. That keeps the project's code
  fully open while protecting the look.
- Make sure fonts bundled in section 3 allow redistribution in
  commercial products (check each font's licence).
- Have a lawyer review, particularly the NC wording against how the store
  and your own commercial offerings use the core design.
