// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
#include "Account.h"

#include "Client.h"
#include "../common/SafeJson.h"

#include <chrono>
#include <cstdlib>
#include <ctime>
#include <thread>

#if JUCE_WINDOWS
#ifndef NOMINMAX
#define NOMINMAX   // windows.h's min and max macros break std::max
#endif
#include <windows.h>
#include <wincred.h>
#else
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>
#endif
#if JUCE_MAC
#include <Security/Security.h>
#endif

namespace bleep::library {
namespace {

juce::var object(std::initializer_list<std::pair<const char*, juce::var>> fields) {
    auto* o = new juce::DynamicObject();
    for (const auto& f : fields) o->setProperty(f.first, f.second);
    return juce::var(o);
}

std::string str(const juce::var& v) { return v.isString() ? v.toString().toStdString() : std::string(); }

/// What went wrong, in the library's words: FastAPI's `detail` (a string, or a list of validation errors).
std::string detailOf(const juce::var& body) {
    const juce::var d = body["detail"];
    if (d.isString()) return str(d);
    if (auto* a = d.getArray(); a && a->size() > 0) {
        const juce::var& first = a->getReference(0);
        std::string where;
        if (auto* loc = first["loc"].getArray(); loc && loc->size() > 0) where = str(loc->getLast()) + ": ";
        return where + str(first["msg"]);
    }
    return {};
}

int64_t unixNow() { return (int64_t)std::time(nullptr); }

}  // namespace

// ---- transport ----------------------------------------------------------------------------------------------

HttpResponse httpSend(const HttpRequest& request) {
    HttpResponse out;
    juce::URL url(juce::String(request.url));
    juce::String headers;
    if (!request.body.empty()) {
        url = url.withPOSTData(juce::String::fromUTF8(request.body.data(), (int)request.body.size()));
        headers << "Content-Type: application/json\r\n";
    }
    if (!request.bearer.empty()) headers << "Authorization: Bearer " << juce::String(request.bearer) << "\r\n";
    int status = 0;
    auto options = juce::URL::InputStreamOptions(request.body.empty() ? juce::URL::ParameterHandling::inAddress
                                                                       : juce::URL::ParameterHandling::inPostData)
                       .withConnectionTimeoutMs(15000).withStatusCode(&status).withNumRedirectsToFollow(0)
                       .withHttpRequestCmd(juce::String(request.method)).withExtraHeaders(headers);
    auto stream = url.createInputStream(options);
    if (!stream) return out;
    out.status = status;
    out.body = stream->readEntireStreamAsString().toStdString();
    return out;
}

void httpStream(const HttpRequest& request, const StreamEvents& events) {
    juce::URL url(juce::String(request.url));
    juce::String headers;
    if (!request.body.empty()) {
        url = url.withPOSTData(juce::String::fromUTF8(request.body.data(), (int)request.body.size()));
        headers << "Content-Type: application/json\r\n";
    }
    headers << "Accept: text/event-stream\r\n";
    if (!request.bearer.empty()) headers << "Authorization: Bearer " << juce::String(request.bearer) << "\r\n";
    int status = 0;
    juce::StringPairArray responseHeaders;
    // The server pings every 15 seconds while the model thinks, so a minute without a byte means the connection is gone.
    auto options = juce::URL::InputStreamOptions(request.body.empty() ? juce::URL::ParameterHandling::inAddress
                                                                       : juce::URL::ParameterHandling::inPostData)
                       .withConnectionTimeoutMs(60000).withStatusCode(&status).withResponseHeaders(&responseHeaders)
                       .withNumRedirectsToFollow(0).withHttpRequestCmd(juce::String(request.method)).withExtraHeaders(headers);
    auto stream = url.createInputStream(options);
    if (!stream) return;
    if (events.head) events.head(status, responseHeaders.getValue("Retry-After", "0").getIntValue());
    char buffer[4096];
    while (!stream->isExhausted()) {
        const int n = stream->read(buffer, (int)sizeof buffer);
        if (n <= 0) break;
        if (events.data && !events.data(buffer, (size_t)n)) break;
    }
}

// ---- token stores -------------------------------------------------------------------------------------------

namespace {

/// <dir>/account.json: { "<library address>": "<token>" }, owner-only on macOS and Linux.
class FileTokenStore : public TokenStore {
public:
    explicit FileTokenStore(juce::File dir) : file_(dir.getChildFile("account.json")) {}
    std::string load(const std::string& account) override {
        const juce::var v = bleep::safejson::parse(file_);
        return v.isObject() ? str(v[juce::Identifier(juce::String(account))]) : std::string();
    }
    bool save(const std::string& account, const std::string& token) override {
        juce::var v = bleep::safejson::parse(file_);
        if (!v.isObject()) v = object({});
        v.getDynamicObject()->setProperty(juce::Identifier(juce::String(account)), juce::String(token));
        return write(juce::JSON::toString(v));
    }
    void clear(const std::string& account) override {
        juce::var v = bleep::safejson::parse(file_);
        if (!v.isObject()) return;
        v.getDynamicObject()->removeProperty(juce::Identifier(juce::String(account)));
        write(juce::JSON::toString(v));
    }

private:
    bool write(const juce::String& text) {
        file_.getParentDirectory().createDirectory();
#if JUCE_WINDOWS
        return file_.replaceWithText(text);
#else
        // Created with 0600 from the start: replaceWithText would make a new file with the default mode.
        const int fd = ::open(file_.getFullPathName().toRawUTF8(), O_WRONLY | O_CREAT | O_TRUNC, 0600);
        if (fd < 0) return false;
        ::fchmod(fd, 0600);
        const auto utf8 = text.toStdString();
        const bool ok = ::write(fd, utf8.data(), utf8.size()) == (ssize_t)utf8.size();
        ::close(fd);
        return ok;
#endif
    }
    juce::File file_;
};

#if JUCE_MAC
/// The login keychain: a generic password per library address. Another program (a DAW hosting the plugin) that did not create the item
/// is asked by macOS the first time; "Always Allow" ends that. A token read once stays in memory for the process: every read of the
/// keychain item can be a new password prompt (a build whose signature changes gets asked again), and the page asks often.
class KeychainTokenStore : public TokenStore {
public:
    std::string load(const std::string& account) override {
        {
            std::lock_guard<std::mutex> lock(cacheMutex());
            const auto it = cache().find(account);
            if (it != cache().end()) return it->second;
        }
        CFMutableDictionaryRef q = query(account);
        CFDictionarySetValue(q, kSecReturnData, kCFBooleanTrue);
        CFDictionarySetValue(q, kSecMatchLimit, kSecMatchLimitOne);
        CFTypeRef found = nullptr;
        std::string token;
        if (SecItemCopyMatching(q, &found) == errSecSuccess && found) {
            token.assign((const char*)CFDataGetBytePtr((CFDataRef)found), (size_t)CFDataGetLength((CFDataRef)found));
            CFRelease(found);
        }
        CFRelease(q);
        if (!token.empty()) {
            std::lock_guard<std::mutex> lock(cacheMutex());
            cache()[account] = token;
        }
        return token;
    }
    bool save(const std::string& account, const std::string& token) override {
        clear(account);
        CFMutableDictionaryRef q = query(account);
        CFDataRef data = CFDataCreate(kCFAllocatorDefault, (const UInt8*)token.data(), (CFIndex)token.size());
        CFDictionarySetValue(q, kSecValueData, data);
        CFDictionarySetValue(q, kSecAttrAccessible, kSecAttrAccessibleAfterFirstUnlock);
        const OSStatus status = SecItemAdd(q, nullptr);
        CFRelease(data);
        CFRelease(q);
        if (status == errSecSuccess) {
            std::lock_guard<std::mutex> lock(cacheMutex());
            cache()[account] = token;
        }
        return status == errSecSuccess;
    }
    void clear(const std::string& account) override {
        {
            std::lock_guard<std::mutex> lock(cacheMutex());
            cache().erase(account);
        }
        CFMutableDictionaryRef q = query(account);
        SecItemDelete(q);
        CFRelease(q);
    }

private:
    static std::map<std::string, std::string>& cache() { static std::map<std::string, std::string> c; return c; }
    static std::mutex& cacheMutex() { static std::mutex m; return m; }
    static CFMutableDictionaryRef query(const std::string& account) {
        CFMutableDictionaryRef q = CFDictionaryCreateMutable(kCFAllocatorDefault, 0, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
        CFStringRef service = CFStringCreateWithCString(kCFAllocatorDefault, "Bleep Library", kCFStringEncodingUTF8);
        CFStringRef name = CFStringCreateWithCString(kCFAllocatorDefault, account.c_str(), kCFStringEncodingUTF8);
        CFDictionarySetValue(q, kSecClass, kSecClassGenericPassword);
        CFDictionarySetValue(q, kSecAttrService, service);
        CFDictionarySetValue(q, kSecAttrAccount, name);
        CFRelease(service);
        CFRelease(name);
        return q;
    }
};
#elif JUCE_WINDOWS
/// The Credential Manager: a generic credential per library address, for this Windows user.
class CredentialTokenStore : public TokenStore {
public:
    std::string load(const std::string& account) override {
        PCREDENTIALW cred = nullptr;
        std::string token;
        if (CredReadW(target(account).toWideCharPointer(), CRED_TYPE_GENERIC, 0, &cred) && cred) {
            token.assign((const char*)cred->CredentialBlob, cred->CredentialBlobSize);
            CredFree(cred);
        }
        return token;
    }
    bool save(const std::string& account, const std::string& token) override {
        const juce::String name = target(account);
        CREDENTIALW cred = {};
        cred.Type = CRED_TYPE_GENERIC;
        cred.TargetName = const_cast<LPWSTR>(name.toWideCharPointer());
        cred.CredentialBlobSize = (DWORD)token.size();
        cred.CredentialBlob = (LPBYTE)token.data();
        cred.Persist = CRED_PERSIST_LOCAL_MACHINE;
        cred.UserName = const_cast<LPWSTR>(L"Bleep");
        return CredWriteW(&cred, 0) != FALSE;
    }
    void clear(const std::string& account) override { CredDeleteW(target(account).toWideCharPointer(), CRED_TYPE_GENERIC, 0); }

private:
    static juce::String target(const std::string& account) { return "Bleep Library|" + juce::String(account); }
};
#endif

}  // namespace

std::unique_ptr<TokenStore> makeFileTokenStore(const juce::File& dir) { return std::make_unique<FileTokenStore>(dir); }

std::unique_ptr<TokenStore> makeTokenStore(const juce::File& dataDir) {
    const char* dev = std::getenv("BLEEP_DATA_DIR");   // tests and development: no keychain, no mix-up with the real login
    if (dev && *dev) return makeFileTokenStore(dataDir);
#if JUCE_MAC
    return std::make_unique<KeychainTokenStore>();
#elif JUCE_WINDOWS
    return std::make_unique<CredentialTokenStore>();
#else
    return makeFileTokenStore(dataDir);
#endif
}

// ---- account ------------------------------------------------------------------------------------------------

Account::Account(juce::File dataDir, Transport transport, std::unique_ptr<TokenStore> tokens, StreamTransport streamTransport)
    : dataDir_(std::move(dataDir)), transport_(transport ? std::move(transport) : Transport(httpSend)),
      tokens_(tokens ? std::move(tokens) : makeTokenStore(dataDir_)),
      streamTransport_(streamTransport ? std::move(streamTransport) : StreamTransport(httpStream)) {}

std::string Account::base() const {
    std::string url = Settings::load(dataDir_).libraryUrl;
    while (!url.empty() && url.back() == '/') url.pop_back();
    return url;
}

/// Sends one request; returns the library's error message (empty when it answered 2xx).
std::string Account::send(const std::string& method, const std::string& path, const juce::var& body, const std::string& token,
                          HttpResponse& out) const {
    if (std::string why; !libraryUrlAllowed(base(), why)) { out = {}; return why; }   // never a token or sign-in over plain http to another host
    HttpRequest r;
    r.method = method;
    r.url = base() + path;
    r.bearer = token;
    if (!body.isVoid()) r.body = juce::JSON::toString(body, true).toStdString();
    out = transport_(r);
    if (out.status == 0) return "cannot reach " + base();
    if (out.status >= 400) {
        const std::string d = detailOf(bleep::safejson::parse(juce::String(out.body)));
        return d.empty() ? "the library answered " + std::to_string(out.status) : d;
    }
    return {};
}

void Account::remember(const juce::var& user) {
    std::lock_guard<std::mutex> lock(mutex_);
    name_ = str(user["display_name"]);
    email_ = str(user["email"]);
}

juce::var Account::status(bool verify) {
    const std::string account = base();
    std::string token = tokens_->load(account);
    bool offline = false;
    if (!token.empty() && verify) {
        HttpResponse r;
        send("GET", "/api/tokens/self", juce::var(), token, r);
        if (r.status == 200) remember(bleep::safejson::parse(juce::String(r.body)));
        else if (r.status == 401) { tokens_->clear(account); token.clear(); }   // revoked on the site (or expired)
        else offline = true;                                                      // keep the token: the library may be down
    }
    std::lock_guard<std::mutex> lock(mutex_);
    auto result = object({{"signedIn", !token.empty()}, {"name", juce::String(token.empty() ? "" : name_)},
                          {"email", juce::String(token.empty() ? "" : email_)}, {"libraryUrl", juce::String(account)}});
    if (offline) result.getDynamicObject()->setProperty("offline", true);
    if (!pending_.deviceCode.empty() && pending_.expiresAt > unixNow())
        result.getDynamicObject()->setProperty("pending", object({{"userCode", juce::String(pending_.userCode)}}));
    return result;
}

juce::var Account::startSignIn(const std::string& clientName) {
    HttpResponse r;
    const std::string error = send("POST", "/api/auth/device", object({{"client_name", juce::String(clientName)}}), {}, r);
    if (!error.empty()) return object({{"error", juce::String(error)}});
    const juce::var d = bleep::safejson::parse(juce::String(r.body));
    if (str(d["device_code"]).empty() || str(d["user_code"]).empty()) return object({{"error", "the library gave no code"}});
    {
        std::lock_guard<std::mutex> lock(mutex_);
        pending_ = {str(d["device_code"]), str(d["user_code"]), unixNow() + (int)d["expires_in"], std::max(2, (int)d["interval"])};
    }
    // The page takes the code from the address, so the user only has to confirm it.
    const std::string url = base() + str(d["verification_url"]);  // no code in the address: the user types the one the app shows
    return object({{"userCode", d["user_code"]}, {"url", juce::String(url)}, {"interval", std::max(2, (int)d["interval"])},
                   {"expiresIn", d["expires_in"]}});
}

juce::var Account::pollSignIn() {
    std::string deviceCode;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (pending_.deviceCode.empty()) return object({{"state", "none"}});
        if (pending_.expiresAt <= unixNow()) { pending_ = {}; return object({{"state", "expired"}}); }
        deviceCode = pending_.deviceCode;
    }
    HttpResponse r;
    const std::string error = send("POST", "/api/auth/device/token", object({{"device_code", juce::String(deviceCode)}}), {}, r);
    if (r.status == 410) { cancelSignIn(); return object({{"state", "expired"}}); }
    if (!error.empty()) return object({{"state", "error"}, {"error", juce::String(error)}});   // keep polling: the network may be back
    const juce::var d = bleep::safejson::parse(juce::String(r.body));
    const std::string state = str(d["status"]);
    if (state == "approved") {
        const std::string token = str(d["token"]);
        if (token.empty() || !tokens_->save(base(), token)) {
            cancelSignIn();
            return object({{"state", "error"}, {"error", "could not keep the sign-in in the keychain"}});
        }
        remember(d["user"]);
        cancelSignIn();
        auto result = status(false);
        result.getDynamicObject()->setProperty("state", "approved");
        return result;
    }
    if (state == "denied") { cancelSignIn(); return object({{"state", "denied"}}); }
    return object({{"state", "pending"}});
}

void Account::cancelSignIn() {
    std::lock_guard<std::mutex> lock(mutex_);
    pending_ = {};
}

juce::var Account::signOut() {
    const std::string account = base();
    const std::string token = tokens_->load(account);
    if (!token.empty()) {
        HttpResponse r;
        send("DELETE", "/api/tokens/self", juce::var(), token, r);   // best effort: offline, the token stays valid on the library until revoked there
        tokens_->clear(account);
    }
    cancelSignIn();
    return status(false);
}

juce::var Account::call(const std::string& method, const std::string& path, const juce::var& body) {
    // Only the library's own API: this is what the page may reach with the user's token.
    if (path.rfind("/api/", 0) != 0 || path.find("..") != std::string::npos || path.find("://") != std::string::npos
        || (method != "GET" && method != "POST" && method != "PUT" && method != "PATCH" && method != "DELETE"))
        return object({{"status", 0}, {"error", "not a call to the library"}});
    const std::string account = base();
    const std::string token = tokens_->load(account);
    // Whether the assistant is switched on is public: the page asks before anyone has signed in.
    if (token.empty() && !(method == "GET" && path == "/api/agent/status")) return object({{"status", 401}, {"error", "Not signed in"}});
    HttpResponse r;
    std::string error = send(method, path, body, token, r);
    if (r.status == 401 && !token.empty()) {   // revoked or expired: this machine is signed out now
        tokens_->clear(account);
        error = "You were signed out; sign in again";
    }
    return object({{"status", r.status}, {"body", bleep::safejson::parse(juce::String(r.body))}, {"error", juce::String(error)}});
}

// ---- streams ------------------------------------------------------------------------------------------------

/// One streaming request: a worker thread fills it, streamRead() empties it.
struct Account::Stream {
    std::mutex m;
    std::condition_variable cv;
    std::string pending;
    bool headSent = false, headReported = false, done = false, cancelled = false;
    int status = 0, retryAfter = 0;
    std::string error;
};

juce::var Account::streamStart(const std::string& path, const juce::var& body) {
    if (path.rfind("/api/agent/", 0) != 0 || path.find("..") != std::string::npos || path.find("://") != std::string::npos)
        return object({{"status", 0}, {"error", "not a call to the assistant"}});
    const std::string account = base();
    if (std::string why; !libraryUrlAllowed(account, why)) return object({{"status", 0}, {"error", juce::String(why)}});
    const std::string token = tokens_->load(account);
    if (token.empty()) return object({{"status", 401}, {"error", "Not signed in"}});
    HttpRequest r;
    r.method = "POST";
    r.url = account + path;
    r.bearer = token;
    r.body = juce::JSON::toString(body, true).toStdString();
    auto s = std::make_shared<Stream>();
    std::string id;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        id = std::to_string(nextStream_++);
        streams_[id] = s;
    }
    auto transport = streamTransport_;
    std::thread([s, r, transport, account]() {
        StreamEvents events;
        events.head = [&](int status, int retryAfter) {
            std::lock_guard<std::mutex> lock(s->m);
            s->status = status;
            s->retryAfter = retryAfter;
            s->headSent = true;
            s->cv.notify_all();
        };
        events.data = [&](const char* bytes, size_t n) {
            std::lock_guard<std::mutex> lock(s->m);
            if (s->cancelled) return false;
            s->pending.append(bytes, n);
            s->cv.notify_all();
            return true;
        };
        transport(r, events);
        std::lock_guard<std::mutex> lock(s->m);
        if (!s->headSent) s->error = "cannot reach " + account;
        s->done = true;
        s->cv.notify_all();
    }).detach();
    return object({{"id", juce::String(id)}});
}

juce::var Account::streamRead(const std::string& id, int timeoutMs) {
    std::shared_ptr<Stream> s;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        auto it = streams_.find(id);
        if (it == streams_.end()) return object({{"done", true}, {"chunk", ""}, {"error", "no such stream"}});
        s = it->second;
    }
    std::unique_lock<std::mutex> lock(s->m);
    // The first answer carries the status; after that, a block (or the end) is news. An error answer is read whole, at its end.
    s->cv.wait_for(lock, std::chrono::milliseconds(timeoutMs), [&] {
        return s->done || s->cancelled || (s->headSent && !s->headReported) ||
               (s->headSent && s->status < 400 && s->pending.find("\n\n") != std::string::npos);
    });
    std::string chunk;
    const bool finished = s->done || s->cancelled;
    if (finished) { chunk.swap(s->pending); }
    else if (const size_t cut = s->pending.rfind("\n\n"); cut != std::string::npos && s->status < 400) {
        chunk = s->pending.substr(0, cut + 2);
        s->pending.erase(0, cut + 2);
    }
    auto result = object({{"chunk", juce::String::fromUTF8(chunk.data(), (int)chunk.size())}, {"done", finished}});
    auto* o = result.getDynamicObject();
    if (s->headSent && !s->headReported) { o->setProperty("status", s->status); o->setProperty("retryAfter", s->retryAfter); }
    s->headReported = s->headSent;
    if (!s->error.empty()) o->setProperty("error", juce::String(s->error));
    const int status = s->status;
    lock.unlock();
    if (finished) {
        std::lock_guard<std::mutex> g(mutex_);
        streams_.erase(id);
    }
    if (status == 401) tokens_->clear(base());   // revoked or expired: this machine is signed out now
    return result;
}

void Account::streamCancel(const std::string& id) {
    std::shared_ptr<Stream> s;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        auto it = streams_.find(id);
        if (it == streams_.end()) return;
        s = it->second;
    }
    std::lock_guard<std::mutex> lock(s->m);
    s->cancelled = true;
    s->cv.notify_all();
}

}  // namespace bleep::library
