# Implementation Plan

## Phase 1: Stabilize the Existing Bridge - Completed

- [x] Add unit-test infrastructure and coverage commands.
- [x] Cover `Packet`, `PacketManager`, QML type guards, and service request envelopes.
- [x] Fix packet primitive bugs, packet framing bugs, and DAP requests that currently do not respond.
- [x] Make initialize capabilities truthful and add `configurationDone` support.

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

## Phase 6: Quality and Documentation Sweep - Completed

- [x] Harden inspector custom requests so source lookup and object-tree expansion fail fast when required Qt services are missing.
- [x] Make runtime views and the optional Qt-backed integration harness resilient to request failures and teardown edge cases.
- [x] Add API descriptions for the new inspector, profiler, runtime-view, and harness surfaces introduced in the recent phases.

## Phase 7: Repository-Wide API Review and Documentation - Completed

- [x] Review the full repository for protocol guard mistakes, lifecycle gaps, and legacy helper issues outside the recent Phase 4/5 files.
- [x] Fix confirmed protocol/type-guard defects in the legacy V8 message helpers and related runtime cleanup paths.
- [x] Add API descriptions across the remaining source and test helper files so the whole repository uses a consistent documented surface.

## Phase 8: Standalone Qt Fixture Project - Completed

- [x] Add a small standalone Qt/QML fixture subproject that can be built separately from the extension but kept in-repo for test use.
- [x] Encode the primary debugging cases in that fixture: launch, source mapping, breakpoints, evaluate, output, inspector selection, and profiler activity.
- [x] Teach the optional Qt integration harness to auto-discover a local build of the fixture and run smoke/assertion coverage against it.

## Follow-Up

- Replace the current transport-level profiler event classifier with a semantic decoder for the Qt Creator timeline stream once more real fixture captures are available.
- Expand the Qt-backed harness from launch smoke coverage to assertions over inspector selection, profiler export contents, and runtime teardown.
