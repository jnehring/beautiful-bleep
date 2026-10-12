// SPDX-License-Identifier: MIT
//
// Media.h — audio files that modules use (a sampler's reel, a wavetable, a
// frozen grain buffer). The board document stores only a media *id*; the
// audio lives as a WAV file in one media folder on the computer
// (doc/specs/modules/splice.md §7), shared by every set:
//
//   macOS    ~/Music/Beautiful Bleep/Media/<id>.wav
//   Windows  %USERPROFILE%\Music\Beautiful Bleep\Media\<id>.wav
//
// Ids are content hashes, so importing the same file twice stores it once and
// a copied board keeps working on any computer that has the media folder.
//
// Threads: everything here runs on the message thread (it touches the disk).
// Modules load clips in setData() and hand them to the audio thread with
// RtHandoff (Handoff.h). No JUCE here.
#pragma once

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace bleep::engine {

/// Decoded audio: planar float channels.
struct MediaClip {
    std::string id;     ///< "<16 hex digits>.wav" (empty until saved)
    std::string name;   ///< the original file name, for the UI
    double sampleRate = 48000.0;
    std::vector<std::vector<float>> channels;

    int numChannels() const noexcept { return (int)channels.size(); }
    int64_t numFrames() const noexcept { return channels.empty() ? 0 : (int64_t)channels[0].size(); }
    double seconds() const noexcept { return sampleRate > 0.0 ? (double)numFrames() / sampleRate : 0.0; }
};

namespace media {

/// The media folder (created on first save). Set once by the engine; tests
/// may point it at a temporary folder.
void setFolder(const std::string& path);
std::string folder();

/// One-time move of the data folders from their old name, "Bleep Patch", to
/// "Beautiful Bleep": the app-data folder (Cells, Drum Patterns, the settings
/// file, whole boards: Patches/*.bleeppatch become Boards/*.bleeppreset) and
/// ~/Music/Bleep Patch (the media folder). Nothing is overwritten: a file that
/// exists under the new name stays, and the old one is left where it is.
/// Safe to call any number of times, from any binary, before the folders are used.
void migrateLegacyFolders();

/// Decodes a WAV file in memory (PCM 8/16/24/32 bit, float 32/64 bit, any
/// channel count). Returns null on anything it can't read.
std::shared_ptr<MediaClip> decodeWav(const uint8_t* data, size_t size, std::string* error = nullptr);
/// Encodes as 32-bit float WAV.
std::vector<uint8_t> encodeWav(const MediaClip& clip);

/// Stores a clip in the media folder (if not there yet) and returns its id.
/// Empty on failure.
std::string save(const MediaClip& clip);
/// Imports a WAV file's bytes: decode, save, return the stored clip (with id).
std::shared_ptr<const MediaClip> import(const uint8_t* data, size_t size, const std::string& name,
                                        std::string* error = nullptr);
/// Loads a clip by id; cached while anyone holds it. Null if missing.
std::shared_ptr<const MediaClip> load(const std::string& id);
/// A valid id looks like "0123456789abcdef.wav" (no paths).
bool validId(const std::string& id);

}  // namespace media
}  // namespace bleep::engine
