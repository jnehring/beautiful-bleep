// SPDX-License-Identifier: MIT
#include "Registry.h"

namespace bleep::engine {

const Registry& Registry::get() {
    static const Registry registry;
    return registry;
}

Registry::Registry() {
    registerFunctionModule(*this);
    registerRandomModule(*this);
    registerUtilityModule(*this);
    registerFilterModule(*this);
    registerPortModules(*this);

    // Cells (spec §8): their jacks live in the board, not in the spec.
    ModuleSpec cell;
    cell.type = kCell;
    cell.name = "Cell";
    cell.category = "Cells";
    cell.colour = "#9aa3b5";
    cell.description = "A group of nodes with its own jacks. Double-click to enter.";
    add(cell, nullptr);
    ModuleSpec in;
    in.type = kCellIn;
    in.name = "Cell In";
    in.category = "Cells";
    in.colour = "#9aa3b5";
    in.userCreatable = false;
    add(in, nullptr);
    ModuleSpec out = in;
    out.type = kCellOut;
    out.name = "Cell Out";
    add(out, nullptr);
}

void Registry::add(ModuleSpec spec, Factory factory) {
    Entry e{std::make_unique<ModuleSpec>(std::move(spec)), std::move(factory)};
    order_.push_back(e.spec.get());
    entries_.push_back(std::move(e));
}

const ModuleSpec* Registry::find(const std::string& type) const noexcept {
    for (const auto& e : entries_)
        if (e.spec->type == type) return e.spec.get();
    return nullptr;
}

const ModuleSpec* Registry::forPort(PortKind kind) const noexcept {
    if (kind == PortKind::None) return nullptr;
    for (const auto& e : entries_)
        if (e.spec->port == kind) return e.spec.get();
    return nullptr;
}

std::unique_ptr<Module> Registry::create(const std::string& type) const {
    for (const auto& e : entries_)
        if (e.spec->type == type) return e.factory ? e.factory(*e.spec) : nullptr;
    return nullptr;
}

}  // namespace bleep::engine
