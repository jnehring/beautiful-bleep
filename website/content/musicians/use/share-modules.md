---
title: Share a module
description: Turn a script into a module and upload it to the Bleep Library so anyone can install it.
order: 6
---

# Share a module with the Bleep Library

A module you wrote in a **Code node** can be published in the Bleep Library, where anyone can install it from the module list and use it like any other module. You do not need a key or any tools: everything happens in the browser.

## Before you start

- You have a script in a Code node that **compiles** (the status line under the editor says so).
- You are **logged in to the Bleep Library** in the same browser. If you are not, the Share dialog says so and links to the login page: log in in another tab, then press **Share** again.
- Your library name is the name your module is published under. If you have none yet, the library makes it when you share for the first time.

## Share it

1. Open the Code node and press **Compile**. Fix any problems listed under the editor.
2. Open the **Metadata** tab if you want to fill in details first: version, summary, category, licence, tags, a web page and release notes. You can also set them in the dialog.
3. Press **Share…**. The dialog asks for:

   | Field | What to put |
   |---|---|
   | **Summary** | One or two sentences, up to 280 characters. The library shows it next to the module. Required |
   | **Category** | Where the module goes in the Add menu, for example *Effects*  |
   | **Licence** | The terms others get: MIT, Apache-2.0, CC0-1.0, GPL-3.0-or-later and others |
   | **Version** | Three numbers with dots, such as `1.0.0` |
   | **Share the source code** | On by default. See [Source code](#share-the-source-code) |
   | **Help page** | Markdown, shown by the module's **?** button. Headings, lists, tables, bold, code and links work; images are left out |

4. Press **Share**. Bleep compiles the module, packs it, uploads it and tells you the result, for example `Shared as yourname/wobble 1.0.0`.

The library checks the upload and signs it. It appears in the library list shortly afterwards, marked *community*. Your module's id is `<your name>/<module name>`.

Whatever you typed in the dialog is kept, even if the upload fails, so you can fix the problem and press **Share** again.

## Share a new version

Each share needs a **higher version** than the last one. The dialog suggests the next number for you. Versions cannot be replaced: a fix is a new version. Put what changed in the release notes on the Metadata tab.

## Share the source code

With **Share the source code** on, the script goes with the module, under the same licence. Anyone who installs it can press **Convert to code** on it, read how it works, change it and make their own version. Turn it off to share only the compiled module.

## The module's picture

If your script draws its own interface, that picture goes with the module. It runs in a locked-down frame: no network, no storage, and it is stopped if it hangs. Nobody's module can run code in the page.

## Install a module from the library

Anyone can install a shared module from the module list in the Bleep Library, or find it in the Add menu once it is installed. It runs in the same sandbox as every other module, and no setting is needed.

## Limits and good to know

- You can publish up to **100 modules** and make **10 uploads an hour**.
- A package is at most 12 MB.
- A module is **not part of a patch file**. If you send someone a patch that uses your module, they need to install the module too, so share it first.
- If the library refuses your upload, the message in the dialog names the rule that failed.
- To withdraw a release, ask the library's admin. Apps that already have it stop loading it after their next update check.

## See also

- [The Code node](/docs/developers/bleep-script/code-node/) for the editor, Convert to module and the Metadata tab
- [Publishing a module](/docs/developers/modules/publishing/) for the command-line route and developer releases
