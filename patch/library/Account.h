// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
//
// Account.h — the user's login to the Bleep Library from the app and the plugins (developers/modules/library.md, "Login in the app"):
// the device flow, the personal token in the OS keychain, and authenticated calls to the library's API (sharing presets, comments,
// ratings). Everything here blocks (network): call it from a worker thread, never from the audio thread or the message thread.
#pragma once

#include <condition_variable>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <string>

#include <juce_core/juce_core.h>

namespace bleep::library {

struct HttpRequest {
    std::string method = "GET";   ///< GET, POST, PUT, PATCH or DELETE
    std::string url;
    std::string body;             ///< JSON, empty for none
    std::string bearer;           ///< sent as `Authorization: Bearer …`, empty for none
};
struct HttpResponse {
    int status = 0;               ///< 0: the server was not reached
    std::string body;
};
using Transport = std::function<HttpResponse(const HttpRequest&)>;

/// What a streaming request reports while the answer arrives (Server-Sent Events: the patch assistant).
struct StreamEvents {
    std::function<void(int status, int retryAfterSeconds)> head;   ///< once, when the headers are in (0: the server was not reached: never called)
    std::function<bool(const char*, size_t)> data;                 ///< each piece of the body; return false to stop reading
};
using StreamTransport = std::function<void(const HttpRequest&, const StreamEvents&)>;

/// The real transport: the system's HTTP stack (NSURLSession, WinINet), with timeouts.
HttpResponse httpSend(const HttpRequest& request);

/// Where the personal token is kept, by library address, so a development library and the real one do not mix.
class TokenStore {
public:
    virtual ~TokenStore() = default;
    virtual std::string load(const std::string& account) = 0;   ///< empty when there is none
    virtual bool save(const std::string& account, const std::string& token) = 0;
    virtual void clear(const std::string& account) = 0;
};

/// Like httpSend, but hands the body over as it arrives, on the calling thread; returns when the answer ended, was stopped or broke off.
void httpStream(const HttpRequest& request, const StreamEvents& events);

/// A file in `dir`, readable by the user only. For Linux (no keychain dependency), and for tests and development (BLEEP_DATA_DIR).
std::unique_ptr<TokenStore> makeFileTokenStore(const juce::File& dir);
/// macOS: the Keychain; Windows: the Credential Manager; elsewhere, and when BLEEP_DATA_DIR is set: the file store in `dataDir`.
std::unique_ptr<TokenStore> makeTokenStore(const juce::File& dataDir);

/// The sign-in of this process. The app and every plugin share the token (one keychain item), so signing in once is enough.
class Account {
public:
    /// `dataDir`: where settings.json says which library to talk to. Without arguments: the real HTTP stack and the real token store.
    explicit Account(juce::File dataDir, Transport transport = {}, std::unique_ptr<TokenStore> tokens = {},
                     StreamTransport streamTransport = {});

    /// {signedIn, name, email, libraryUrl, pending?: {userCode}, offline?}. `verify` asks the library whether the token still works
    /// (a revoked token is dropped); without it nothing goes over the network.
    juce::var status(bool verify = false);
    /// Starts the device flow: {userCode, url (to open in the browser), interval, expiresIn}, or {error}.
    juce::var startSignIn(const std::string& clientName);
    /// One poll of the flow: {state: "none"|"pending"|"approved"|"denied"|"expired"|"error", error?, + status() when approved}.
    juce::var pollSignIn();
    void cancelSignIn();
    /// Revokes the token at the library (best effort) and forgets it.
    juce::var signOut();
    /// An authenticated call to the library's API. `path` starts with /api/. {status, body, error?}; a 401 signs this machine out.
    juce::var call(const std::string& method, const std::string& path, const juce::var& body);

    /// A streaming POST to the assistant (`/api/agent/…`) with the login, answered piece by piece: the page cannot reach the network itself
    /// (it is served from the app), so it pulls the answer through these three. Returns {id} or {status, error}.
    juce::var streamStart(const std::string& path, const juce::var& body);
    /// Waits up to `timeoutMs` for news of stream `id`: {chunk, done, status?, retryAfter?, error?}. `status` comes with the first answer;
    /// while the stream runs, `chunk` ends at a block boundary (a blank line), so a multi-byte character is never split.
    juce::var streamRead(const std::string& id, int timeoutMs);
    void streamCancel(const std::string& id);

private:
    struct Stream;
    std::string base() const;           ///< the library's address without a trailing slash
    std::string send(const std::string& method, const std::string& path, const juce::var& body, const std::string& token,
                     HttpResponse& out) const;
    void remember(const juce::var& user);

    juce::File dataDir_;
    Transport transport_;
    std::unique_ptr<TokenStore> tokens_;
    StreamTransport streamTransport_;
    std::mutex mutex_;
    std::map<std::string, std::shared_ptr<Stream>> streams_;   ///< guarded by mutex_
    int nextStream_ = 1;
    std::string name_, email_;          ///< of the signed-in user, as last heard from the library
    struct Pending { std::string deviceCode, userCode; int64_t expiresAt = 0; int interval = 5; } pending_;
};

}  // namespace bleep::library
