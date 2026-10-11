---
title: RFC process
description: How to propose a change to the Bleep Bus standard.
order: 30
---

# Changing the standard: RFCs

Bleep Bus is maintained by Brilliant Bleep in public. Anyone can propose a
change.

1. **Issue.** Open a GitHub issue labelled `rfc` describing the problem, not
   the solution.
2. **Design doc.** If maintainers agree it is worth solving, open a pull
   request adding `website/content/rfcs/NNNN-title.md`: motivation, design,
   layout changes, compatibility, alternatives.
3. **Discussion.** At least two weeks in the open.
4. **Decision.** Maintainers accept, postpone or reject, and record the
   reasoning in the RFC.
5. **Implementation.** Spec text, SDK, conformance checks and docs change in
   the same pull request.

Version rules: 0.x minors may break the layout; after 1.0, minor versions
only add fields in reserved space and new majors use a new segment name.
