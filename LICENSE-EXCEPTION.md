# Bleep Module Exception

SPDX identifier: `AdditionRef-Bleep-Module-Exception`

Additional permission under section 7 of the GNU General Public License,
version 3. It applies to the files under `patch/` marked
`GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception`.

As a special exception, the copyright holders of Bleep give you
permission to combine Bleep with a Module, to convey the resulting
combination, and to license the Module under terms of your choice,
including proprietary terms, with or without charge, provided that:

1. **Module** means a software component, such as a board module, that is
   loaded and run by Bleep and that interacts with it only through the
   Module API.

2. **Module API** means the Module ABI described in
   `website/content/developers/modules/module-abi.md` (in the version your
   Module was built for), and the Module SDK: the headers
   `patch/engine/Module.h`, `Spec.h`, `Registry.h`, `DrumModule.h` and
   `Media.h`, and the headers in `patch/common/dsp/`.

3. The Module does not contain or derive from any other part of Bleep's
   source code that is licensed under the GPL. Copying such code from
   outside the Module API makes the Module a derivative work of Bleep, and
   it must then be licensed under the GPL. Parts of the repository that
   carry another licence (for example the ported built-in modules and
   Bleep Bus) may be reused under that licence.

4. This exception does not cover modifications to Bleep itself. A modified
   version of Bleep, whether a fork or a patched copy, remains under the
   GPL without exception.

You may remove this exception from your copy of a modified version of
Bleep. If you do, the GPL applies to that version without it. This
exception grants no trademark rights; see `doc/licensing/TRADEMARK.md`.
