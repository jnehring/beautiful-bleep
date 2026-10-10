# Third-party code

Code copied into the repository, with its own licence. Not covered by the repository's SPDX rule (`scripts/check/check-repo.py` skips this folder).

| Folder | What | Version | Licence | Why |
|---|---|---|---|---|
| [`monocypher/`](monocypher/) | [Monocypher](https://monocypher.org): Ed25519 signature checks (`monocypher-ed25519.c` is the standard Ed25519 with SHA-512; the default EdDSA of the library uses another hash and does not match) | 4.0.2 | BSD-2-Clause or CC0-1.0, your choice | The apps and plugins check module signatures (doc/specs/signing.md) without OpenSSL or any system library |

To update: replace the files from a release of the project and run the store tests (`ctest -R patch.store`).
