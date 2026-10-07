// SPDX-License-Identifier: MIT
//
// bleep_bus.hpp — header-only C++17 RAII wrapper around the Bleep Bus C API.
//
// Thin by design: every method maps to one C function documented in
// bleep_bus.h, with the same thread rules ([RT] / [non-RT]). Use the C API
// directly whenever this wrapper gets in the way.
//
//   bleep::Bus bus;                                    // [non-RT]
//   bleep::Endpoint ep(bus, "LFO", "Example", "Me");   // [non-RT]
//   bleep::Output out = ep.addOutput("out");           // [non-RT]
//   ...
//   ep.beginBlock(info);  out.write(buf, n);  ep.endBlock();   // [RT]
#pragma once

#include "bleep_bus.h"

#include <cstdint>
#include <string>
#include <utility>
#include <vector>

namespace bleep {

/// One mapping of the bus. Movable, not copyable.
class Bus {
public:
    explicit Bus(const char* busNamespace = nullptr)
        : bus_(bb_bus_open(BB_SPEC_VERSION, busNamespace, &error_)) {}
    ~Bus() { bb_bus_close(bus_); }

    Bus(const Bus&) = delete;
    Bus& operator=(const Bus&) = delete;
    Bus(Bus&& other) noexcept : bus_(std::exchange(other.bus_, nullptr)), error_(other.error_) {}
    Bus& operator=(Bus&& other) noexcept {
        if (this != &other) {
            bb_bus_close(bus_);
            bus_ = std::exchange(other.bus_, nullptr);
            error_ = other.error_;
        }
        return *this;
    }

    bool ok() const noexcept { return bus_ != nullptr; }
    bb_error error() const noexcept { return error_; }
    bb_bus* get() const noexcept { return bus_; }

    uint32_t registryGeneration() const noexcept { return bb_registry_generation(bus_); }
    uint32_t connectionGeneration() const noexcept { return bb_connection_generation(bus_); }

    std::vector<bb_endpoint_info> endpoints() const {
        return list<bb_endpoint_info>([&](bb_endpoint_info* d, uint32_t c) { return bb_list_endpoints(bus_, d, c); });
    }
    std::vector<bb_output_info> outputs() const {
        return list<bb_output_info>([&](bb_output_info* d, uint32_t c) { return bb_list_outputs(bus_, d, c); });
    }
    std::vector<bb_input_info> inputs(uint64_t endpointUid) const {
        return list<bb_input_info>(
            [&](bb_input_info* d, uint32_t c) { return bb_list_inputs(bus_, endpointUid, d, c); });
    }
    std::vector<bb_connection_info> connections(uint64_t endpointUid, const char* inputName) const {
        return list<bb_connection_info>(
            [&](bb_connection_info* d, uint32_t c) { return bb_list_connections(bus_, endpointUid, inputName, d, c); });
    }

    bb_error connect(uint64_t dstUid, const char* input, uint64_t srcUid, const char* output, float amount) {
        return bb_connect(bus_, dstUid, input, srcUid, output, amount);
    }
    bb_error disconnect(uint64_t dstUid, const char* input, uint64_t srcUid, const char* output) {
        return bb_disconnect(bus_, dstUid, input, srcUid, output);
    }
    bb_error disconnectAll(uint64_t dstUid, const char* input) { return bb_disconnect_all(bus_, dstUid, input); }

    std::vector<float> peek(uint64_t endpointUid, const char* output) const {
        std::vector<float> v(BB_MAX_BLOCK_SAMPLES);
        v.resize(bb_peek_output(bus_, endpointUid, output, v.data(), (uint32_t)v.size()));
        return v;
    }

private:
    template <typename T, typename F>
    static std::vector<T> list(F&& fn) {
        // Retry if the table grew between the two calls.
        for (;;) {
            uint32_t n = fn(nullptr, 0);
            std::vector<T> v(n);
            uint32_t m = fn(v.data(), n);
            if (m <= n) {
                v.resize(m);
                return v;
            }
        }
    }

    bb_bus* bus_ = nullptr;
    bb_error error_ = BB_OK;
};

/// Non-owning handle to an output. Valid while its Endpoint lives.
class Output {
public:
    Output() = default;
    explicit Output(bb_output* o) : out_(o) {}
    bool valid() const noexcept { return out_ != nullptr; }
    bb_output* get() const noexcept { return out_; }
    void write(const float* samples, uint32_t n) const noexcept { bb_write_output(out_, samples, n); }  // [RT]

private:
    bb_output* out_ = nullptr;
};

/// Non-owning handle to an input. Valid while its Endpoint lives.
class Input {
public:
    Input() = default;
    explicit Input(bb_input* i) : in_(i) {}
    bool valid() const noexcept { return in_ != nullptr; }
    bb_input* get() const noexcept { return in_; }
    /// Fills dest with the summed, amount-scaled sources. Returns sources present. [RT]
    uint32_t read(float* dest, uint32_t n) const noexcept { return bb_read_input(in_, dest, n); }

private:
    bb_input* in_ = nullptr;
};

/// One registered plugin instance. Unregisters on destruction.
class Endpoint {
public:
    Endpoint(Bus& bus, const char* displayName, const char* product, const char* vendor, uint64_t uid = 0) {
        bb_instance_info info = BB_INSTANCE_INFO_INIT;
        info.uid = uid;
        info.display_name = displayName;
        info.product = product;
        info.vendor = vendor;
        ep_ = bb_register_instance(bus.get(), &info, &error_);
    }
    ~Endpoint() { bb_unregister_instance(ep_); }

    Endpoint(const Endpoint&) = delete;
    Endpoint& operator=(const Endpoint&) = delete;

    bool ok() const noexcept { return ep_ != nullptr; }
    bb_error error() const noexcept { return error_; }
    bb_endpoint* get() const noexcept { return ep_; }
    uint64_t uid() const noexcept { return bb_endpoint_uid(ep_); }
    uint32_t patchVersion() const noexcept { return bb_endpoint_patch_version(ep_); }

    bb_error setUid(uint64_t uid) { return bb_set_instance_uid(ep_, uid); }
    bb_error setName(const std::string& name) { return bb_set_instance_name(ep_, name.c_str()); }
    bb_error setTrackName(const std::string& name) { return bb_set_track_name(ep_, name.c_str()); }

    Output addOutput(const char* name, bb_signal_type type = BB_SIGNAL_CONTROL,
                     bb_polarity polarity = BB_POLARITY_BIPOLAR, bb_error* err = nullptr) {
        return Output(bb_add_output(ep_, name, type, polarity, err));
    }
    Input addInput(const char* name, bb_signal_type type = BB_SIGNAL_CONTROL, bb_error* err = nullptr) {
        return Input(bb_add_input(ep_, name, type, err));
    }

    void beginBlock(const bb_block_info& info) noexcept { bb_begin_block(ep_, &info); }  // [RT]
    void endBlock() noexcept { bb_end_block(ep_); }                                     // [RT]

    std::string saveConnections() const {
        size_t needed = bb_save_connections(ep_, nullptr, 0);
        std::string s(needed, '\0');
        needed = bb_save_connections(ep_, s.data(), s.size());
        s.resize(needed > 0 ? needed - 1 : 0);
        return s;
    }
    bb_error loadConnections(const std::string& s) { return bb_load_connections(ep_, s.data(), s.size()); }

private:
    bb_endpoint* ep_ = nullptr;
    bb_error error_ = BB_OK;
};

}  // namespace bleep
