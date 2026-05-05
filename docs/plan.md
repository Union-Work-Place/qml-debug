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

## Phase 3: Qt Creator Parity - Completed

- [x] Add launch mode that starts the target with generated `-qmljsdebugger` arguments.
- [x] Add pause support if the Qt service supports interruption for the active runtime.
- [x] Extend watch, hover, exception, and output behavior to match Qt Creator expectations.
- [x] Add integration tests against a small QML fixture application.

## Phase 4: Inspector and Profiler Work - Completed

- [x] Add QML Inspector support where the Qt debug service is available.
- [x] Add scene graph/profiler collection as a separate DAP/custom-view feature set.
- [x] Document supported Qt versions and service capability differences.

## Phase 5: Post-Phase 4 Follow-Up - Completed

- [x] Add a real Qt-backed integration suite harness that launches a fixture with `QmlInspector` and `CanvasFrameRate` enabled when a Qt fixture is available.
- [x] Extend the profiler from packet snapshots to a typed event decoder and timeline export so traffic can be filtered by event kind without leaving VS Code.
- [x] Add full `QmlDebugger` object-tree decoding with property payloads and context groupings so the inspector view can show object metadata instead of only runtime ids.
- [x] Add launch configuration snippets and presets for `CanvasFrameRate,EngineControl,DebugMessages` so profiler capture can be enabled without hand-editing `services` arrays.

## Follow-Up

- Replace the current transport-level profiler event classifier with a semantic decoder for the Qt Creator timeline stream once more real fixture captures are available.
- Expand the Qt-backed harness from launch smoke coverage to assertions over inspector selection, profiler export contents, and runtime teardown.
