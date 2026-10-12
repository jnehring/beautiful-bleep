// SPDX-License-Identifier: MIT
//
// System Audio on macOS: a Core Audio process tap (macOS 14.2+, doc/specs/system-audio.md §6.1).
//
// A global stereo tap mixes everything the computer plays, minus this process. The tap is read through a private
// aggregate device that has the default output as its clock; the aggregate and the tap exist only while the app runs.
// First use asks the user for permission (NSAudioCaptureUsageDescription); without it the tap delivers silence.
//
// Compiled with ARC (CMakeLists.txt).
#import <CoreAudio/AudioHardwareTapping.h>
#import <CoreAudio/CATapDescription.h>
#import <CoreAudio/CoreAudio.h>
#import <Foundation/Foundation.h>

#include "SystemAudio.h"

#include <unistd.h>

#include <atomic>
#include <chrono>
#include <mutex>

namespace bleep::app {
namespace {

constexpr AudioObjectPropertyElement kMain = 0;  // kAudioObjectPropertyElementMain needs macOS 12 as the target

bool tapsAvailable() {
    if (@available(macOS 14.2, *)) return true;
    return false;
}

AudioObjectPropertyAddress address(AudioObjectPropertySelector selector,
                                   AudioObjectPropertyScope scope = kAudioObjectPropertyScopeGlobal) {
    return {selector, scope, kMain};
}

AudioObjectID defaultOutputDevice() {
    AudioObjectID device = kAudioObjectUnknown;
    UInt32 size = sizeof(device);
    auto a = address(kAudioHardwarePropertyDefaultOutputDevice);
    AudioObjectGetPropertyData(kAudioObjectSystemObject, &a, 0, nullptr, &size, &device);
    return device;
}

NSString* deviceUid(AudioObjectID device) {
    CFStringRef uid = nullptr;
    UInt32 size = sizeof(uid);
    auto a = address(kAudioDevicePropertyDeviceUID);
    if (AudioObjectGetPropertyData(device, &a, 0, nullptr, &size, &uid) != noErr || !uid) return nil;
    return (__bridge_transfer NSString*)uid;
}

/// This process as Core Audio knows it. Unknown until the app has played audio once (the JUCE device has started).
AudioObjectID ownProcessObject() {
    AudioObjectID object = kAudioObjectUnknown;
    pid_t pid = getpid();
    UInt32 size = sizeof(object);
    auto a = address(kAudioHardwarePropertyTranslatePIDToProcessObject);
    if (AudioObjectGetPropertyData(kAudioObjectSystemObject, &a, sizeof(pid), &pid, &size, &object) != noErr)
        return kAudioObjectUnknown;
    return object;
}

OSStatus defaultOutputChanged(AudioObjectID, UInt32, const AudioObjectPropertyAddress*, void* client);
OSStatus tapProc(AudioObjectID, const AudioTimeStamp*, const AudioBufferList* in, const AudioTimeStamp*,
                 AudioBufferList*, const AudioTimeStamp*, void* client);

class MacSystemAudio final : public SystemAudio {
public:
    ~MacSystemAudio() override { stop(); }

    std::string start(const SystemAudioOptions& options) override {
        stop();
        std::lock_guard<std::mutex> lock(mutex_);
        exclude_ = options.excludeOwnProcess;
        auto a = address(kAudioHardwarePropertyDefaultOutputDevice);
        AudioObjectAddPropertyListener(kAudioObjectSystemObject, &a, defaultOutputChanged, this);
        listening_ = true;
        auto error = build();
        if (!error.empty()) teardown();  // the listener stays: stop() removes it
        return error;
    }

    void stop() override {
        std::lock_guard<std::mutex> lock(mutex_);
        if (listening_) {
            auto a = address(kAudioHardwarePropertyDefaultOutputDevice);
            AudioObjectRemovePropertyListener(kAudioObjectSystemObject, &a, defaultOutputChanged, this);
            listening_ = false;
        }
        teardown();
    }

    /// Message thread, a few times a second: follows a change of the default output, and puts the own-process exclusion
    /// in place once Core Audio knows this process (it plays no audio before the app's device starts).
    void poll() override {
        std::lock_guard<std::mutex> lock(mutex_);
        if (!listening_) return;
        const bool outputChanged = outputChanged_.exchange(false);
        const bool exclusionPossible = exclude_ && !excluding_ && ownProcessObject() != kAudioObjectUnknown;
        const bool running = tap_ != kAudioObjectUnknown;
        if (!outputChanged && !exclusionPossible && running) return;
        const auto now = std::chrono::steady_clock::now();
        if (!running && !outputChanged && now - lastTry_ < std::chrono::seconds(2)) return;  // a failed build: not at 10 Hz
        lastTry_ = now;
        teardown();
        const auto error = build();
        problem_ = error;
    }

    double sampleRate() const override { return rate_; }
    bool excluding() const override { return excluding_; }
    std::string problem() const override {
        std::lock_guard<std::mutex> lock(mutex_);
        return problem_;
    }

    void noteOutputChanged() { outputChanged_ = true; }

    // The IO thread. `in` holds the aggregate's input streams: the tap's are the last.
    void onInput(const AudioBufferList* in) {
        if (!in || in->mNumberBuffers == 0) return;
        if (planar_) {
            if (in->mNumberBuffers < (UInt32)channels_) return;
            const float* planes[2] = {nullptr, nullptr};
            const UInt32 first = in->mNumberBuffers - (UInt32)channels_;
            for (int c = 0; c < channels_ && c < 2; ++c) planes[c] = (const float*)in->mBuffers[first + (UInt32)c].mData;
            const auto& b = in->mBuffers[first];
            if (planes[0]) ring_.writePlanar(planes, std::min(channels_, 2), (int)(b.mDataByteSize / sizeof(float)));
            return;
        }
        for (UInt32 i = in->mNumberBuffers; i > 0; --i) {  // the last buffer that has the tap's channel count
            const auto& b = in->mBuffers[i - 1];
            if ((int)b.mNumberChannels != channels_ || !b.mData) continue;
            ring_.writeInterleaved((const float*)b.mData, (int)(b.mDataByteSize / (sizeof(float) * (UInt32)channels_)),
                                   channels_);
            return;
        }
    }

private:
    /// Creates the tap, the aggregate device and starts reading. Holds mutex_.
    std::string build() {
        if (!tapsAvailable()) return "System audio capture needs macOS 14.2 or later.";
        if (@available(macOS 14.2, *)) {
            const AudioObjectID output = defaultOutputDevice();
            NSString* outputUid = output == kAudioObjectUnknown ? nil : deviceUid(output);
            if (!outputUid) return "There is no audio output to capture.";

            NSArray<NSNumber*>* excluded = @[];
            excluding_ = false;
            if (exclude_) {
                const AudioObjectID self = ownProcessObject();
                if (self != kAudioObjectUnknown) {
                    excluded = @[ @(self) ];
                    excluding_ = true;
                }
            }
            CATapDescription* description = [[CATapDescription alloc] initStereoGlobalTapButExcludeProcesses:excluded];
            NSUUID* tapUuid = [NSUUID UUID];
            description.name = @"Bleep App system audio";
            description.UUID = tapUuid;
            description.privateTap = YES;
            description.muteBehavior = CATapUnmuted;

            OSStatus status = AudioHardwareCreateProcessTap(description, &tap_);
            if (status != noErr) {
                tap_ = kAudioObjectUnknown;
                return "Core Audio refused the system audio tap (error " + std::to_string((int)status) + ").";
            }

            AudioStreamBasicDescription format{};
            UInt32 size = sizeof(format);
            auto formatAddress = address(kAudioTapPropertyFormat);
            if (AudioObjectGetPropertyData(tap_, &formatAddress, 0, nullptr, &size, &format) != noErr ||
                format.mFormatID != kAudioFormatLinearPCM || !(format.mFormatFlags & kAudioFormatFlagIsFloat)) {
                return "The system audio tap has a format Bleep App cannot read.";
            }
            channels_ = (int)format.mChannelsPerFrame;
            planar_ = (format.mFormatFlags & kAudioFormatFlagIsNonInterleaved) != 0;
            if (channels_ < 1) return "The system audio tap has no channels.";

            NSDictionary* aggregate = @{
                @kAudioAggregateDeviceNameKey : @"Bleep App system audio",
                @kAudioAggregateDeviceUIDKey : [[NSUUID UUID] UUIDString],
                @kAudioAggregateDeviceMainSubDeviceKey : outputUid,
                @kAudioAggregateDeviceIsPrivateKey : @YES,
                @kAudioAggregateDeviceIsStackedKey : @NO,
                @kAudioAggregateDeviceTapAutoStartKey : @YES,
                @kAudioAggregateDeviceSubDeviceListKey : @[ @{@kAudioSubDeviceUIDKey : outputUid} ],
                @kAudioAggregateDeviceTapListKey :
                    @[ @{@kAudioSubTapDriftCompensationKey : @YES, @kAudioSubTapUIDKey : [tapUuid UUIDString]} ],
            };
            status = AudioHardwareCreateAggregateDevice((__bridge CFDictionaryRef)aggregate, &aggregate_);
            if (status != noErr) {
                aggregate_ = kAudioObjectUnknown;
                return "Core Audio could not create the capture device (error " + std::to_string((int)status) + ").";
            }

            Float64 rate = 0.0;
            size = sizeof(rate);
            auto rateAddress = address(kAudioDevicePropertyNominalSampleRate);
            if (AudioObjectGetPropertyData(aggregate_, &rateAddress, 0, nullptr, &size, &rate) != noErr || rate <= 0.0)
                rate = format.mSampleRate > 0.0 ? format.mSampleRate : 48000.0;
            rate_ = rate;

            status = AudioDeviceCreateIOProcID(aggregate_, tapProc, this, &proc_);
            if (status != noErr) return "Core Audio could not read the system audio (error " + std::to_string((int)status) + ").";
            status = AudioDeviceStart(aggregate_, proc_);
            if (status != noErr) return "Core Audio could not start the system audio capture (error " + std::to_string((int)status) + ").";
            return {};
        }
        return "System audio capture needs macOS 14.2 or later.";
    }

    /// Holds mutex_.
    void teardown() {
        if (@available(macOS 14.2, *)) {
            if (aggregate_ != kAudioObjectUnknown) {
                if (proc_) {
                    AudioDeviceStop(aggregate_, proc_);
                    AudioDeviceDestroyIOProcID(aggregate_, proc_);
                }
                AudioHardwareDestroyAggregateDevice(aggregate_);
            }
            if (tap_ != kAudioObjectUnknown) AudioHardwareDestroyProcessTap(tap_);
        }
        proc_ = nullptr;
        aggregate_ = kAudioObjectUnknown;
        tap_ = kAudioObjectUnknown;
        excluding_ = false;
    }

    mutable std::mutex mutex_;
    AudioObjectID tap_ = kAudioObjectUnknown, aggregate_ = kAudioObjectUnknown;
    AudioDeviceIOProcID proc_ = nullptr;
    bool listening_ = false, exclude_ = true;
    int channels_ = 2;
    bool planar_ = false;
    std::atomic<bool> outputChanged_{false};
    std::atomic<bool> excluding_{false};
    std::atomic<double> rate_{48000.0};
    std::string problem_;
    std::chrono::steady_clock::time_point lastTry_{};
};

OSStatus defaultOutputChanged(AudioObjectID, UInt32, const AudioObjectPropertyAddress*, void* client) {
    static_cast<MacSystemAudio*>(client)->noteOutputChanged();
    return noErr;
}

OSStatus tapProc(AudioObjectID, const AudioTimeStamp*, const AudioBufferList* in, const AudioTimeStamp*,
                 AudioBufferList*, const AudioTimeStamp*, void* client) {
    static_cast<MacSystemAudio*>(client)->onInput(in);
    return noErr;
}

}  // namespace

std::string SystemAudio::unsupportedReason() {
    return tapsAvailable() ? std::string() : "System audio capture needs macOS 14.2 or later.";
}
bool SystemAudio::canExclude() { return tapsAvailable(); }
std::vector<std::pair<std::string, std::string>> SystemAudio::sources() { return {}; }
std::unique_ptr<SystemAudio> SystemAudio::create() {
    return tapsAvailable() ? std::unique_ptr<SystemAudio>(new MacSystemAudio()) : nullptr;
}

}  // namespace bleep::app
