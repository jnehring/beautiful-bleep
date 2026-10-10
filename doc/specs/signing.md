# Signing modules and plugins

Everything the shop distributes as **code** is signed: modules (WebAssembly, see [`module-abi.md`](module-abi.md)) and plugins (installers for the VST3 family). A signature says two things: **who** published it, and that **not one byte has changed** since. Every developer has a private key of their own and signs with it; the user's apps check the signature before loading and refuse code that is unsigned unless the user has switched that on in the settings.

The reference implementation is [`scripts/signing.py`](../../scripts/signing.py) with its tests in [`scripts/test_signing.py`](../../scripts/test_signing.py). This document is the specification; where they differ, fix whichever is wrong. Section 14 has a test vector other implementations must reproduce.

## 1. What it protects, and what it does not

| Protects against | How |
|---|---|
| A file changed after publishing (on the CDN, in a cache, on disk) | The signature covers a hash of every file in the package. |
| Someone else publishing under another developer's or our name | Only a developer's own key signs their ids; a certificate binds the key to a publisher name and namespace. |
| A signature moved to another module, another version, another platform | The signed statement contains the kind, id, version and platform. |
| A stolen developer key | Certificates expire; the registry revokes a key or a single release, and clients check a signed revocation list. |
| The registry (or its storage) being hacked | The attacker cannot make a developer signature. They can still withhold updates or serve old ones, which the signed `index.json` (section 9) limits. |

It does **not** make a module safe by itself: a signed module is the work of an identified developer, nothing more. Modules also run in a sandbox (the ABI gives them no files, no network, a memory cap and a time limit). **Plugins are native code with the user's full rights; a signature only tells whose code it is.** It also cannot stop Ableton from loading some other VST3 the user put in the plugin folder: enforcement for plugins happens where Bleep installs and checks them (section 11).

## 2. The chain of trust

```
root key            offline, held by Brilliant Bleep; its public key is built into every app and plugin
  └─ issuer key     online, in the registry; certified by the root (valid for years, revocable)
       └─ developer key     one per developer (or per team), made on the developer's own machine;
            │                certified by the issuer after the developer has an account
            └─ signature    over one package: a module, or one platform file of a plugin
```

- **Why an issuer between root and developers.** The root key never goes online. The registry can then issue and renew developer certificates day to day with a key that can be thrown away and replaced if it leaks, and the root signs a new issuer certificate.
- **Brilliant Bleep's own releases** are signed by a developer key like any other, with the publisher `bleep` and the `firstParty` flag, which alone allows ids without a namespace (`reverb`, not `acme/fuzz`).
- **The developer's private key** is made by the admin today and handed over (section 10); the registry keeps only its key id. Once developers outside the team publish, they make their own and send only a request.

**Where each key lives.**

| Key | Where | Why there |
|---|---|---|
| Root, private | **Offline**: the owner's keystore, with a backup. Not in the repository, not in `website/.env`, not on the server. Needed only to certify a new issuer or to revoke one. | If the root leaked, every app and plugin that has its public key would have to be updated. A server is the most likely thing to be broken into, so it must not hold the one key that cannot be replaced. |
| Root, public | `BLEEP_ROOT_PUBLIC_KEYS` in `website/.env` (the registry checks releases against it) and built into the apps and plugins | It is public; two keys during a rotation. |
| Issuer, private, and its certificate | `BLEEP_ISSUER_KEY`, `BLEEP_ISSUER_CERT` in `website/.env` | The registry needs it to issue developer keys. If it leaks, the root revokes it and certifies a new one: nothing already installed has to change. |
| Developer, private | The developer's machine or CI, as the kit the admin handed over | Only they can sign as them. |

`scripts/signing.py init-registry DIR` makes the root and the issuer in one go and writes `registry.env` with the three lines for `website/.env`; `root.key` is then moved to the keystore and the copy deleted.

## 3. Primitives

- **Signatures: Ed25519** (RFC 8032): 32-byte public keys, 64-byte signatures, deterministic, fast, no parameters to get wrong.
- **Hash: SHA-256.**
- A **key id** is the first 16 bytes of the SHA-256 of the 32-byte public key, as 32 hex characters.
- Every signed message starts with a **domain string** (`BLEEP-CONTENT-1\n`, `BLEEP-SIG-1\n`, `BLEEP-CERT-1\n`, `BLEEP-CRL-1\n`), so a signature made for one purpose can never be accepted for another.
- Variable-length fields in a message are **length-prefixed** (`lp(x)` = 4-byte big-endian length, then the bytes), so two different field lists can never produce the same bytes.
- JSON that is signed (certificates, the revocation list) is first turned into **canonical** UTF-8: keys sorted, no whitespace.
- Why not RSA, PGP or X.509: smaller, a format we fully control, no ASN.1 parser in the audio plugin, and no trust in the operating system's certificate store (see 13).

## 4. The content hash

A **package** is a set of files with relative paths: the contents of a `.bleepmod` zip, or the files of a plugin's installer payload. **The signature is over the content, not over the zip**, because zip files are not reproducible (order, compression, timestamps): repacking the same files must not break it.

```
contentDigest = SHA-256(
    "BLEEP-CONTENT-1\n"
    u32(file count)
    for every file, sorted by the UTF-8 bytes of its path:
        lp(path)  ‖  SHA-256(file content) (32 bytes)  ‖  executable (1 byte: 0 or 1)
)
```

- Paths use `/`, are relative, and contain no empty, `.` or `..` part and no backslash or NUL; a package that has one is refused. Duplicate paths and symbolic links are refused.
- `META/signature.json` (section 6) is never part of the content.
- Directories are not listed; permissions other than "executable" are not signed (they are not reproducible across systems, and the host decides them).
- Plugins: a **single installer file** (`.pkg`, `.msi`, `.zip`) is a package of one file whose path is its name. A plugin release has one such file per platform, each with its own signature, so a platform added later (the release machine and the Windows build machine are different) signs its own file.

## 5. The signed statement

```
message = "BLEEP-SIG-1\n" ‖ lp(kind) ‖ lp(id) ‖ lp(version) ‖ lp(platform) ‖ lp(signerKeyId) ‖ lp(contentDigest)
signature = Ed25519-sign(developerPrivateKey, message)
```

`kind` is `module` or `plugin`, `id` and `version` are the registry's (for example `acme/fuzz`, `1.0.0`), `platform` is `any` or the platform id (`macos-arm64`). **The verifier takes all of these from the artifact and its registry entry, never from the signature document**: a signature that is valid for something else is not valid here.

## 6. Certificates and the signature document

A **certificate** is `{"tbs": {...}, "issuer": <keyId of the signer>, "signature": <base64>}`; the signature is the parent's Ed25519 over `"BLEEP-CERT-1\n" ‖ canonical(tbs)`. The `tbs` ("to be signed") object:

| Field | Meaning |
|---|---|
| `format` | `1` |
| `type` | `issuer` or `developer` |
| `keyId`, `publicKey` | The certified key (base64 of the 32 bytes) and its id. |
| `publisher` | The developer's namespace slug (`acme`), lower case letters, digits and `-`. Unique in the registry; a name belongs to the first account that gets it and is not reassigned. |
| `name` | Display name. |
| `scopes` | `["module"]`, `["module","plugin"]`, … what the key may sign. Issuer certificates have `["issue"]`. **Plugins are a separate scope** the registry grants after a review, because they are native code. |
| `firstParty` | `true` for Brilliant Bleep's own key: may sign ids without a namespace. |
| `notBefore`, `notAfter` | Unix seconds. Developer certificates last at most 365 days and are renewed (a new certificate for the same key, or a new key). |
| `serial` | An integer, for the registry's records. |

The **signature document** is stored as `META/signature.json` inside every package, and the registry's `entry.json` repeats it per file (`files[].signature`), so a client can check a download against the entry:

```json
{ "format": 1, "algorithm": "ed25519", "keyId": "<developer key id>",
  "chain": [ <issuer certificate (by the root)>, <developer certificate (by the issuer)> ],
  "signature": "<base64 of the 64 bytes>" }
```

The chain is carried with the signature so verification needs **no network**: only the pinned root public key(s) and, optionally, the latest revocation list.

## 7. Verification

`verify(package, signatureDocument, kind, id, version, platform, roots, now, revocationList)` returns one of:

| Status | Meaning |
|---|---|
| `signed` | Everything below passed. Carries the publisher and key id. |
| `unsigned` | There is no signature document. |
| `expired` | Everything passed except that a certificate is outside its validity period. |
| `revoked` | Valid, but the key (or the issuer, or this exact release) is on the revocation list. |
| `invalid` | Anything else: the signature, a certificate, the namespace, the scope, a malformed document. |

Steps, in this order; the first failure decides:

1. The document is `format` 1, algorithm `ed25519`, with a chain of exactly [issuer, developer].
2. The issuer certificate is signed by one of the pinned **root** public keys (the app carries one, and the next one during a rotation) and is of type `issuer` with scope `issue`; its key id matches its key.
3. The developer certificate is signed by that issuer and is of type `developer`; its key id matches its key and the document's `keyId`.
4. **Revocation** (section 8): any key in the chain on the list, or this `(kind, id, version, contentDigest)` on the list: `revoked`.
5. The certificate's `scopes` contain `kind`.
6. **Namespace:** `id` starts with `<publisher>/`; only a `firstParty` certificate may sign an id without a `/`.
7. The signature verifies over the message of section 5, with the content digest recomputed from the files.
8. Validity periods of both certificates contain `now`: otherwise `expired`. (This comes last on purpose: an old release by a developer whose certificate has since lapsed is old, not forged.)

Verification never throws on bad input; malformed documents are `invalid`.

**Whether to load.** The settings decide, for modules and plugins separately (`allowUnsigned.module`, `allowUnsigned.plugin`, both off by default):

| Status | Setting off | Setting on |
|---|---|---|
| `signed` | load | load |
| `unsigned` | **refuse** | load, marked unsigned |
| `expired` | refuse | load, marked unsigned |
| `invalid` | refuse | **refuse** |
| `revoked` | refuse | **refuse** |

`invalid` and `revoked` are not overridden by "allow unsigned": the user allowed *no signature*, not *a broken one*. (Someone who strips the signature away gets `unsigned`, which is exactly the situation the user chose to allow.)

## 8. Revocation, expiry and rotation

- **The revocation list** is a JSON document the registry signs with the issuer key and publishes next to `index.json` (the index references it). It holds `serial` (rising), `issued`, `revokedKeys` (`keyId`: everything signed under that key, or under any certificate it issued) and `revokedArtifacts` (`kind`, `id`, `version`, `contentDigest`). Clients fetch it with the index, keep the newest by `serial`, and apply it offline. A client that has never fetched one still verifies; it just cannot know about revocations.
- **A stolen developer key:** revoke the key. Everything signed with it stops loading; the developer gets a new key and re-signs the releases that are still good (signing is cheap, and the content did not change).
- **A bad release:** revoke that `(id, version, digest)`; other versions are untouched.
- **A leaked issuer key:** the root signs a revocation for the issuer's key id and a new issuer certificate; developer certificates are reissued by the new issuer (the developers' keys do not change, so their packages do not need re-signing, only the chain inside the signature has to be replaced; the client treats a chain whose issuer is revoked as `revoked` and the registry serves the repaired signature in `entry.json`).
- **Root rotation:** apps carry up to two root public keys. A new app release adds the next root; later it drops the old one. The root key is generated and used on an offline machine only.
- **Time** comes from the device clock. A device with a wrong clock sees `expired` (and can allow unsigned), never `signed`-by-mistake for something forged. Registry-served metadata (`index.json`, with `generated` and `expires`) lets a client notice a stale clock.

## 9. The registry's own signature

Package signatures say who built a file. The registry additionally signs `index.json` (and the revocation list) with the **issuer key**, to protect what the packages cannot: which release is the newest. `index.json` carries a rising `serial`, a `generated` time and an `expires` time (a week); a client rejects an index whose `serial` is lower than one it has seen, or that has expired, so a server or a mirror cannot hold clients on an old, vulnerable release (a rollback or freeze). The index lists each entry's `contentDigest`, so a client knows what to expect before downloading.

## 10. How a developer gets a key and signs

**Today: the admin issues the key and hands it over.** There is no developer self-service yet.

```
admin      docker compose exec api python -m app.cli developer-create acme --scopes module [--days 365] > acme.kit.json
admin      docker compose exec api python -m app.cli token-create "acme CI" --publisher acme > token
           (hand both over privately: the kit is the developer's private key and certificate)
developer  scripts/signing.py sign fuzz.bleepmod --kit acme.kit.json --kind module --id acme/fuzz --version 1.0.0
developer  scripts/release.py … --kit acme.kit.json --token-file token      (Bleep's own plugins: the "bleep" kit and an unrestricted token)
```

- **The trade-off.** The admin generates the key, so the admin has seen it. That is fine for a handful of people the admin knows; the registry stores only the key id, scopes and expiry (table `developers`), never the key. A developer who wants a key nobody else has seen uses the request flow, which the tool already has (`keygen`, `request`, then the admin runs `issue`), and later the website will take the request directly.
- **Account and checks (when the website does it).** A website account with a confirmed e-mail address. A **module** scope is granted automatically for a publisher name nobody holds; the **plugin** scope and the `bleep` namespace by an admin only. Names that look like ours or like existing publishers are reserved.
- **Revoking.** `python -m app.cli developer-revoke KEY_ID`: releases signed with that key are refused from then on. Publishing the signed revocation list to clients (section 8) is not built yet.
- **Key custody.** `keygen` writes the private key as a PKCS#8 PEM, encrypted with a passphrase when `BLEEP_KEY_PASSPHRASE` is set, mode 0600. The recommendation is a passphrase, kept in the OS keychain; a CI system holds it as a secret. A developer who loses the key requests a new one; the old certificate is revoked if there is any doubt. Hardware keys (a YubiKey with Ed25519, or a cloud KMS that offers it) work through the same interface: the tool only needs a signing function.
- **One key per developer or team.** Whoever holds the key can publish as the publisher. A team uses one key held in CI, or several keys, each with its own certificate under the same publisher.
- **What the registry enforces on every release** (built; `website/api/app/routers/registry.py`):
  1. **Every file needs a valid signature, or the release fails.** Verified under section 7 against the root keys and the revoked developer keys. With no root key configured the registry refuses everything (fail closed); `BLEEP_REQUIRE_SIGNATURES=false` exists for local experiments only.
  2. **A token releases for one publisher.** A release token has a `publisher` (default `bleep`); the signature's publisher must be the same, or the request is refused. One release has one publisher, and a platform added later must be signed by the same one.
  3. **A signed module package must be the one that was signed.** The release declares the content hash; when the file arrives, the registry opens the zip and recomputes it.
  4. **Who uploaded is recorded.** Each file stores the token that declared it (shown by name in the admin's download details, never in the public `entry.json`) and the signer's publisher and key id. Only that token may continue a draft: upload files, replace the draft or publish it.
  5. **`scripts/release.py` checks first.** Before building or uploading, it signs a probe with the kit and verifies it against the registry's root keys (`GET /api/registry/roots`), so a wrong or expired kit fails at once instead of after a 100 MB upload.

  The shop publishes nothing unsigned. Packages that are not in the shop (a developer's own test builds) can still be signed locally, so the same verification path runs everywhere.

## 11. In the apps

**Where it runs.**

| Place | When | What it does |
|---|---|---|
| Module loader in the engine (`WasmModuleHost`) | When a module file is first used, and again when the file's hash changes | Verifies before the file is compiled, never after. Refuses per section 7. The result is cached with the file's hash, so the audio thread is never involved. |
| Software Center (module and plugin installs, updates) | Before anything is written to the install folders | Downloads to a temporary folder, verifies, then moves. A refusal says why in the user's words. |
| Plugin check at startup | The app and the Bleep plugins look at the Bleep plugins in the system folders | Recomputes the installer's installed-file record and compares it with what the Software Center recorded; a plugin that was changed afterwards, or that Bleep did not install, is shown as *not verified*. This is detection, not prevention: Live loads whatever is in its folder. |
| Registry upload | On `POST …/releases`, at the file upload, and when a platform is added | Verifies; refuses unsigned, invalid, revoked or for the wrong publisher (built). |
| Website | Build and download pages | Shows the publisher and key id of every entry. |

**Manual installs.** Dropping a `.bleepmod` (or a `.wasm` with a `module.json` next to it) into the modules folder works the same as installing from the registry: the folder is read at start and when it changes, each file is verified, and the node types it provides appear. A file in a folder that is not signed, or not signed by a trusted publisher, needs **Allow unsigned modules**. Plugins copied by hand into a system plugin folder are untouched by Live's loading, but the Software Center and the startup check list them as *unsigned* or *not verified*, and the Bleep plugins refuse to **install or connect to** an unsigned Bleep plugin (a bridge, a bus receiver) unless **Allow unsigned plugins** is on.

**Settings → Security.**

- **Allow unsigned modules** (off). Switching it on shows: "Unsigned modules run in a sandbox: they cannot read your files or use the network, but they can use a lot of CPU and make noise. Only enable this for modules you trust or have built yourself."
- **Allow unsigned plugins** (off). Switching it on shows: "Unsigned plugins are programs that run with all your rights inside your DAW. Only enable this for software you trust."
- **Trusted developers**: the developers whose keys are in the chain of what you have installed, with a way to remove one (it stops everything they signed from loading). *Advanced:* add a **local root key**, so a developer can test their own signed modules, which carry a certificate issued by their own local registry or `signing.py init-registry`, without allowing everything that is unsigned.
- A status line per installed module and plugin: *Signed by acme* (key id on hover), *Unsigned*, *Expired*, *Revoked*; refused items stay listed with the reason.

**On the board.** A node whose module was refused becomes a placeholder with the reason ("this module is unsigned: enable it in the settings"), never a deletion, as for a missing module in `registry.md` section 4.3. Nothing is ever downloaded or verified on the audio thread, and a plugin in Live uses only what is already installed.

**Choosing between copies.** When several copies provide the same node type (the version bundled in the plugin, one from the registry, one from the manual folder), the host takes the first that passes verification in this order: the highest compatible `version`, then signed over unsigned, then the manual folder over the registry (so a developer's own build wins while they work on it).

## 12. Bundles

A **bundle** is a registry entry of `kind: "bundle"` with no files: a signed list of `(kind, id, version, contentDigest)` members, published and signed like any other entry (publisher `bleep`). Installing one installs its members, each verified on its own. `default-modules` lists every first-party module; `default-plugins` lists every Bleep VST3 (Bleep Patch, the four port plugins, Instrument, Audio Insert, Audio Bridge), as `registry.md` section 5a describes.

## 13. Decisions and alternatives

| Question | Decision | Why |
|---|---|---|
| Own chain of trust or the OS's code signing (Apple notarisation, Authenticode)? | Both, for different things. **OS signing** is what lets macOS and Windows run the installer and the plugin at all, and stays, done by the release pipeline. **This chain** says who published a *module* and lets Bleep check a file itself, on every OS, with no OS certificate store. For plugins, our signature is over the installer or file as released, made *after* OS signing. | A `.wasm` has no OS-level signature; we need one rule for both. |
| Sign the zip bytes or the content? | The content (section 4). | Zips are not reproducible. |
| Developer keys made by the registry or by the developer? | By the developer. | The registry cannot lose or leak what it never has; proof of possession is in the request. |
| One signature algorithm only? | Yes, Ed25519; a new one means a new `format`. | No algorithm negotiation, no downgrade. |
| Trust on first use for developers without the registry? | No. | A local root key (section 11) covers the legitimate case explicitly. |
| Timestamps? | Not used: no trusted time source offline. Expiry is checked against the device clock, and the index is the freshness anchor. | Keeps verification offline and simple; the cost is that an expired developer needs a renewed certificate. |

## 14. Test vector

Fixed seeds (32 bytes each of `0x01`, `0x02`, `0x03`) for the root, the issuer and the developer; `notBefore` 1760000000, `notAfter` one year later. Package `acme/fuzz` 1.0.0, kind `module`, platform `any`, files:

| path | content |
|---|---|
| `module.json` | `{"name":"Fuzz"}` and a newline |
| `module.wasm` | the 8 bytes `00 61 73 6d 01 00 00 00` |
| `ui/fuzz.js` | `// view` and a newline |

None executable. Expected, in hex:

```
root public key        8a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c
issuer public key      8139770ea87d175f56a35466c34c7ecccb8d8a91b4ee37a25df60f5b8fc9b394
developer public key   ed4928c628d1c2c6eae90338905995612959273a5c63f93636c14614ac8737d1
developer key id       b62e867fa2f33afe62d5d6b1642e1621
contentDigest          39f61d45e3115066a934dabca6cf83c346420153e85d6d58841033d62d0c1f08
signature (64 bytes)   5019b69bf480dae36510479a2c4bbeab84e94477efcdd4ec3dc1528ef6f2644471e89b42c0ac69b4ff617bac7da69e4b817717e2f99e6526d4be2c10e1a72c0b
```

`scripts/signing.py vector` prints these and the 123-byte message; the unit test pins them. The digest and the message were also recomputed from this text alone, without the implementation.

## 15. Implementation

| Where | With |
|---|---|
| Registry, release tooling, CI | Python: `cryptography` (Ed25519, SHA-256), see `scripts/signing.py`. The website API will import the same module. |
| Engine, plugins and app (C++) | A small public-domain Ed25519 implementation (Monocypher, one source file) and `juce::SHA256`: no OpenSSL, no system dependency in an audio plugin. |
| Browser (Bleep Board) | WebCrypto Ed25519 where it exists, `@noble/ed25519` otherwise. |

All three run the same test vector in their tests.

## 16. Not decided yet

- The **root key ceremony** is decided in outline: generated on an offline machine, held in the owner's keystore with a backup, used only to certify or revoke an issuer. Still open: a second person or device that can recover it, and a written rotation drill.
- **Publishing the revocation list** to clients, signed by the issuer (the registry already refuses revoked keys itself).
- Whether `community` (third-party, signed, not reviewed by us) is a separate release channel from `stable`, or all signed modules appear in one list with the publisher shown.
- The plugin scope review: what we check before an admin grants it.
- Whether the installers also carry the content-addressed file list of the installed plugin (what the startup check compares), or the Software Center keeps it only locally.
