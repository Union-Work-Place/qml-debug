# Implementation Plan

## Phase 1: Stabilize the Existing Bridge

- Add unit-test infrastructure and coverage commands.
- Cover `Packet`, `PacketManager`, QML type guards, and service request envelopes.
- Fix packet primitive bugs, packet framing bugs, and DAP requests that currently do not respond.
- Make initialize capabilities truthful and add `configurationDone` support.

## Phase 2: DAP Adapter Hardening - Completed

- [x] Refactor `QmlDebugSession` so breakpoints can be accepted during DAP configuration and synchronized after attach.
- [x] Add tests for breakpoints, stack traces, scopes, variables, evaluate, stepping, and disconnect paths with mocked services.
- [x] Normalize source path mapping for `qrc:/` and filesystem paths.
- [x] Improve error responses and termination behavior for failed handshakes and missing services.

## Phase 3: Qt Creator Parity

- Add launch mode that starts the target with generated `-qmljsdebugger` arguments.
- Add pause support if the Qt service supports interruption for the active runtime.
- Extend watch, hover, exception, and output behavior to match Qt Creator expectations.
- Add integration tests against a small QML fixture application.

## Phase 4: Inspector and Profiler Work

- Add QML Inspector support where the Qt debug service is available.
- Add scene graph/profiler collection as a separate DAP/custom-view feature set.
- Document supported Qt versions and service capability differences.
