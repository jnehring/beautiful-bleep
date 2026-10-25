// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
//
// Package.h — reading a module package (a .bleepmod, a zip) safely, for the apps and plugins (developers/modules/library.md). The same
// rules as patch/web/js/library-client.js; the packages in patch/tests/library-fixtures give both the same verdicts.
#pragma once

#include <array>
#include <cstdint>
#include <map>
#include <string>
#include <vector>

namespace bleep::library {

using Digest = std::array<uint8_t, 32>;

/// The files of a package (a zip).
struct Package {
    std::map<std::string, std::vector<uint8_t>> files;
};

/// Reads a zip: stored and deflate, no zip64. Refuses duplicates, symbolic links, unsafe paths and anything that is not a zip.
/// A META/signature.json from an older package is left out.
bool readPackage(const uint8_t* data, size_t size, Package& out, std::string& error);

/// Is every file of a package one a community module may bring? Module data and the sandboxed .wasm, no page scripts:
/// module.json, module.wasm, spec.json, LICENSE, view.sandbox.js, source.dsp.ts, image.png|jpg|webp, doc/*.md and doc/*.png.
/// The library refuses anything else at upload; a client checks again. `why` names the first offender.
bool communityFilesOk(const Package& pkg, std::string& why);

Digest sha256(const uint8_t* data, size_t size);
std::string toHex(const uint8_t* data, size_t size);
std::vector<uint8_t> fromHex(const std::string& hex);

}  // namespace bleep::library
