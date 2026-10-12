// SPDX-License-Identifier: MIT
//
// System Audio on Windows: WASAPI loopback (doc/specs/system-audio.md §6.2).
//
// Process loopback (Windows 10 build 20348+, Windows 11) captures every process but this one, whatever the output
// device; it is tried first when the app's own sound is to be left out. Otherwise, and on older Windows, the default
// output device is opened in loopback mode, which includes everything it plays. A loopback stream delivers no packets
// while nothing plays, so the thread fills the gaps with silence to keep the ring on a steady clock.
#ifndef NOMINMAX
#define NOMINMAX
#endif
#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#include <audioclient.h>
#include <mmdeviceapi.h>
#include <objidl.h>
#include <mmreg.h>
#include <ksmedia.h>
#if __has_include(<audioclientactivationparams.h>)
#include <audioclientactivationparams.h>
#define BLEEP_PROCESS_LOOPBACK 1
#else
#define BLEEP_PROCESS_LOOPBACK 0
#endif

#ifndef AUDCLNT_STREAMFLAGS_SRCDEFAULTQUALITY  // the name in Microsoft's SDK; MinGW calls it SRC_DEFAULT_QUALITY
#define AUDCLNT_STREAMFLAGS_SRCDEFAULTQUALITY 0x08000000
#endif

#include "SystemAudio.h"

#include <atomic>
#include <chrono>
#include <cstdio>
#include <future>
#include <memory>
#include <mutex>
#include <thread>
#include <utility>

namespace bleep::app {
namespace {

template <class T>
struct Com {
    T* p = nullptr;
    Com() = default;
    Com(const Com&) = delete;
    Com& operator=(const Com&) = delete;
    ~Com() { reset(); }
    void reset() {
        if (p) p->Release();
        p = nullptr;
    }
    T** put() {
        reset();
        return &p;
    }
    T* operator->() const { return p; }
    explicit operator bool() const { return p != nullptr; }
};

std::string hresultText(const char* what, HRESULT hr) {
    char code[16];
    snprintf(code, sizeof(code), "0x%08lX", (unsigned long)hr);
    return std::string(what) + " (" + code + ")";
}

#if BLEEP_PROCESS_LOOPBACK
/// ActivateAudioInterfaceAsync's callback: signals an event; the result is read from the operation afterwards.
class ActivationHandler final : public IActivateAudioInterfaceCompletionHandler, public IAgileObject {
public:
    ActivationHandler() : event_(CreateEventW(nullptr, TRUE, FALSE, nullptr)) {}
    ~ActivationHandler() { if (event_) CloseHandle(event_); }
    HANDLE event() const { return event_; }

    HRESULT STDMETHODCALLTYPE ActivateCompleted(IActivateAudioInterfaceAsyncOperation*) override {
        SetEvent(event_);
        return S_OK;
    }
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid, void** out) override {
        if (iid == __uuidof(IUnknown) || iid == __uuidof(IActivateAudioInterfaceCompletionHandler)) {
            *out = static_cast<IActivateAudioInterfaceCompletionHandler*>(this);
        } else if (iid == __uuidof(IAgileObject)) {
            *out = static_cast<IAgileObject*>(this);
        } else {
            *out = nullptr;
            return E_NOINTERFACE;
        }
        AddRef();
        return S_OK;
    }
    ULONG STDMETHODCALLTYPE AddRef() override { return (ULONG)++refs_; }
    ULONG STDMETHODCALLTYPE Release() override {
        const ULONG n = (ULONG)--refs_;
        if (n == 0) delete this;
        return n;
    }

private:
    HANDLE event_;
    std::atomic<long> refs_{1};
};
#endif

class WinSystemAudio final : public SystemAudio {
public:
    ~WinSystemAudio() override { stop(); }

    std::string start(const SystemAudioOptions& options) override {
        stop();
        exclude_ = options.excludeOwnProcess;
        stopping_ = false;
        auto opened = std::make_shared<std::promise<std::string>>();
        auto result = opened->get_future();
        thread_ = std::thread([this, opened] { run(*opened); });
        return result.get();
    }

    void stop() override {
        stopping_ = true;
        if (thread_.joinable()) thread_.join();
    }

    double sampleRate() const override { return rate_; }
    bool excluding() const override { return excluding_; }
    std::string problem() const override {
        std::lock_guard<std::mutex> lock(mutex_);
        return problem_;
    }

private:
    struct Stream {
        Com<IAudioClient> client;
        Com<IAudioCaptureClient> capture;
        HANDLE event = nullptr;
        int channels = 2;
        double rate = 48000.0;
        bool process = false;       ///< process loopback: independent of the output device, own process left out
        std::wstring device;        ///< device loopback: the endpoint it listens to
        ~Stream() { if (event) CloseHandle(event); }
    };

    void run(std::promise<std::string>& opened) {
        const bool comOk = SUCCEEDED(CoInitializeEx(nullptr, COINIT_MULTITHREADED));
        Stream stream;
        std::string error = open(stream);
        opened.set_value(error);
        if (!error.empty()) {
            if (comOk) CoUninitialize();
            return;
        }
        auto lastWrite = std::chrono::steady_clock::now();
        auto lastCheck = lastWrite;
        while (!stopping_) {
            if (stream.event) WaitForSingleObject(stream.event, 10);
            else Sleep(5);

            bool got = false, lost = false;
            for (;;) {
                UINT32 packet = 0;
                HRESULT hr = stream.capture->GetNextPacketSize(&packet);
                if (FAILED(hr)) { lost = true; break; }
                if (packet == 0) break;
                BYTE* data = nullptr;
                UINT32 frames = 0;
                DWORD flags = 0;
                hr = stream.capture->GetBuffer(&data, &frames, &flags, nullptr, nullptr);
                if (FAILED(hr)) { lost = true; break; }
                if ((flags & AUDCLNT_BUFFERFLAGS_SILENT) || !data) ring_.writeSilence((int)frames);
                else ring_.writeInterleaved(reinterpret_cast<const float*>(data), (int)frames, stream.channels);
                stream.capture->ReleaseBuffer(frames);
                got = true;
            }

            const auto now = std::chrono::steady_clock::now();
            if (got) {
                lastWrite = now;
            } else if (now - lastWrite >= std::chrono::milliseconds(20)) {  // nothing plays: keep the clock running
                const double seconds = std::chrono::duration<double>(now - lastWrite).count();
                ring_.writeSilence((int)(seconds * stream.rate));
                lastWrite = now;
            }

            // The default output changed (device loopback only), or the stream broke: open it again.
            if (!stream.process && now - lastCheck >= std::chrono::seconds(1)) {
                lastCheck = now;
                if (defaultDevice() != stream.device) lost = true;
            }
            if (lost) {
                Stream next;
                const std::string again = open(next);
                std::lock_guard<std::mutex> lock(mutex_);
                if (again.empty()) {
                    stream.client->Stop();
                    std::swap(stream.client.p, next.client.p);
                    std::swap(stream.capture.p, next.capture.p);
                    std::swap(stream.event, next.event);
                    stream.channels = next.channels;
                    stream.rate = next.rate;
                    stream.process = next.process;
                    stream.device = next.device;
                    problem_.clear();
                } else {
                    problem_ = again;
                    Sleep(500);
                }
            }
        }
        if (stream.client) stream.client->Stop();
        stream.capture.reset();
        stream.client.reset();
        if (comOk) CoUninitialize();
    }

    std::string open(Stream& s) {
        std::string processError;
#if BLEEP_PROCESS_LOOPBACK
        if (exclude_) {
            processError = openProcessLoopback(s);
            if (processError.empty()) {
                rate_ = s.rate;
                excluding_ = true;
                return {};
            }
        }
#endif
        excluding_ = false;
        const std::string error = openDeviceLoopback(s);
        if (error.empty()) rate_ = s.rate;
        return error;
    }

    std::string openProcessLoopback(Stream& s) {
#if BLEEP_PROCESS_LOOPBACK
        AUDIOCLIENT_ACTIVATION_PARAMS params{};
        params.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
        params.ProcessLoopbackParams.TargetProcessId = GetCurrentProcessId();
        params.ProcessLoopbackParams.ProcessLoopbackMode = PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE;
        PROPVARIANT variant{};
        variant.vt = VT_BLOB;
        variant.blob.cbSize = sizeof(params);
        variant.blob.pBlobData = reinterpret_cast<BYTE*>(&params);

        auto* handler = new ActivationHandler();
        Com<IActivateAudioInterfaceAsyncOperation> operation;
        HRESULT hr = ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, __uuidof(IAudioClient), &variant,
                                                 handler, operation.put());
        std::string error;
        if (FAILED(hr)) {
            error = hresultText("process loopback is not available", hr);
        } else if (WaitForSingleObject(handler->event(), 5000) != WAIT_OBJECT_0) {
            error = "process loopback did not start";
        } else {
            HRESULT activated = E_FAIL;
            Com<IUnknown> unknown;
            hr = operation->GetActivateResult(&activated, unknown.put());
            if (FAILED(hr) || FAILED(activated) || !unknown) error = hresultText("process loopback is not available", FAILED(hr) ? hr : activated);
            else hr = unknown->QueryInterface(__uuidof(IAudioClient), reinterpret_cast<void**>(s.client.put()));
            if (error.empty() && (FAILED(hr) || !s.client)) error = hresultText("process loopback gave no audio client", hr);
        }
        handler->Release();
        if (!error.empty()) return error;

        WAVEFORMATEX format{};
        format.wFormatTag = WAVE_FORMAT_IEEE_FLOAT;
        format.nChannels = 2;
        format.nSamplesPerSec = 48000;
        format.wBitsPerSample = 32;
        format.nBlockAlign = (WORD)(format.nChannels * format.wBitsPerSample / 8);
        format.nAvgBytesPerSec = format.nSamplesPerSec * format.nBlockAlign;
        s.event = CreateEventW(nullptr, FALSE, FALSE, nullptr);
        hr = s.client->Initialize(AUDCLNT_SHAREMODE_SHARED,
                                  AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK |
                                      AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRCDEFAULTQUALITY,
                                  2000000, 0, &format, nullptr);
        if (FAILED(hr)) return hresultText("process loopback refused its format", hr);
        hr = s.client->SetEventHandle(s.event);
        if (FAILED(hr)) return hresultText("process loopback has no event", hr);
        hr = s.client->GetService(__uuidof(IAudioCaptureClient), reinterpret_cast<void**>(s.capture.put()));
        if (FAILED(hr)) return hresultText("process loopback has no capture client", hr);
        s.channels = 2;
        s.rate = 48000.0;
        s.process = true;
        hr = s.client->Start();
        if (FAILED(hr)) return hresultText("process loopback did not start", hr);
        return {};
#else
        (void)s;
        return "this build has no process loopback";
#endif
    }

    static std::wstring defaultDevice() {
        Com<IMMDeviceEnumerator> enumerator;
        if (FAILED(CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, __uuidof(IMMDeviceEnumerator),
                                    reinterpret_cast<void**>(enumerator.put()))))
            return {};
        Com<IMMDevice> device;
        if (FAILED(enumerator->GetDefaultAudioEndpoint(eRender, eConsole, device.put()))) return {};
        LPWSTR id = nullptr;
        if (FAILED(device->GetId(&id)) || !id) return {};
        std::wstring result(id);
        CoTaskMemFree(id);
        return result;
    }

    std::string openDeviceLoopback(Stream& s) {
        Com<IMMDeviceEnumerator> enumerator;
        HRESULT hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, __uuidof(IMMDeviceEnumerator),
                                      reinterpret_cast<void**>(enumerator.put()));
        if (FAILED(hr)) return hresultText("Windows audio is not available", hr);
        Com<IMMDevice> device;
        hr = enumerator->GetDefaultAudioEndpoint(eRender, eConsole, device.put());
        if (FAILED(hr)) return "There is no audio output to capture.";
        LPWSTR id = nullptr;
        if (SUCCEEDED(device->GetId(&id)) && id) {
            s.device = id;
            CoTaskMemFree(id);
        }
        hr = device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, reinterpret_cast<void**>(s.client.put()));
        if (FAILED(hr)) return hresultText("the audio output cannot be opened", hr);

        WAVEFORMATEX* mix = nullptr;
        hr = s.client->GetMixFormat(&mix);
        if (FAILED(hr) || !mix) return hresultText("the audio output has no format", hr);
        bool isFloat = mix->wFormatTag == WAVE_FORMAT_IEEE_FLOAT;
        if (mix->wFormatTag == WAVE_FORMAT_EXTENSIBLE && mix->cbSize >= 22)
            isFloat = reinterpret_cast<WAVEFORMATEXTENSIBLE*>(mix)->SubFormat == KSDATAFORMAT_SUBTYPE_IEEE_FLOAT;
        DWORD flags = AUDCLNT_STREAMFLAGS_LOOPBACK;
        WAVEFORMATEX own{};
        const WAVEFORMATEX* format = mix;
        if (!isFloat || mix->wBitsPerSample != 32) {  // the engine mixes in float; if not, ask for stereo float instead
            own.wFormatTag = WAVE_FORMAT_IEEE_FLOAT;
            own.nChannels = 2;
            own.nSamplesPerSec = mix->nSamplesPerSec;
            own.wBitsPerSample = 32;
            own.nBlockAlign = 8;
            own.nAvgBytesPerSec = own.nSamplesPerSec * 8;
            format = &own;
            flags |= AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRCDEFAULTQUALITY;
        }
        s.channels = format->nChannels;
        s.rate = (double)format->nSamplesPerSec;
        hr = s.client->Initialize(AUDCLNT_SHAREMODE_SHARED, flags, 2000000, 0, format, nullptr);
        CoTaskMemFree(mix);
        if (FAILED(hr)) return hresultText("the audio output cannot be captured", hr);
        hr = s.client->GetService(__uuidof(IAudioCaptureClient), reinterpret_cast<void**>(s.capture.put()));
        if (FAILED(hr)) return hresultText("the audio output has no capture client", hr);
        s.process = false;
        hr = s.client->Start();
        if (FAILED(hr)) return hresultText("the audio capture did not start", hr);
        return {};
    }

    mutable std::mutex mutex_;
    std::thread thread_;
    std::atomic<bool> stopping_{false}, excluding_{false};
    std::atomic<double> rate_{48000.0};
    bool exclude_ = true;
    std::string problem_;
};

}  // namespace

std::string SystemAudio::unsupportedReason() { return {}; }
bool SystemAudio::canExclude() { return BLEEP_PROCESS_LOOPBACK != 0; }
std::vector<std::pair<std::string, std::string>> SystemAudio::sources() { return {}; }
std::unique_ptr<SystemAudio> SystemAudio::create() { return std::unique_ptr<SystemAudio>(new WinSystemAudio()); }

}  // namespace bleep::app
