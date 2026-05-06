# Qt Fixture Subproject

This subproject is a small standalone Qt Quick application used by the repository's optional real-Qt integration harness.

It is intentionally kept separate from the VS Code extension build. The extension and unit tests do not compile it automatically, but once you build it locally the test suite can launch it through `npm run test:qt-integration`.

## Build

Using package scripts:

```sh
npm run fixture:configure
npm run fixture:build
```

Using CMake directly:

```sh
cmake -S test/qt-fixture -B test/qt-fixture/build
cmake --build test/qt-fixture/build
```

The default executable location expected by the harness is one of:

- `test/qt-fixture/build/qml-debug-fixture`
- `test/qt-fixture/build/Debug/qml-debug-fixture`
- `test/qt-fixture/build/Release/qml-debug-fixture`

You can still point the harness at another build by setting `QML_DEBUG_QT_FIXTURE_PROGRAM`, `QML_DEBUG_QT_FIXTURE_CWD`, and `QML_DEBUG_QT_FIXTURE_QML_PATH`.

## Covered Debug Cases

The fixture is small on purpose, but each file is there to exercise a real debugger surface:

- `main.cpp`: verifies the extension can launch and attach to a real Qt Quick executable.
- `qml/Main.qml`: covers startup logs, timers, bound properties, helper-function calls, signal handlers, mouse interaction, and source mapping for the root file.
- `qml/helpers.js`: provides a JavaScript helper so evaluate and breakpoint flows can touch script code in addition to inline QML expressions.
- `qml/components/FixturePanel.qml`: creates a named inspector target with nested objects, properties, and a click path that mutates state and emits output.
- `qml/components/FixtureDelegate.qml`: creates repeated child objects so the inspector tree and variable lookup paths see model-backed object graphs.
- `Canvas` and animation activity in `qml/Main.qml`: produce profiler and scene-graph traffic without requiring a large app.

## Suggested Manual Debug Checklist

- Set breakpoints in `qml/Main.qml` inside `onTriggered`, `onClicked`, and `onStatusTriggered`.
- Set a breakpoint in `qml/helpers.js` inside `decorateStatus`.
- Inspect `fixtureWindow`, `inspectorTarget`, `graphCanvas`, and `delegate_*` objects in the inspector tree.
- Evaluate `decoratedStatus`, `counter`, `buildMessage("manual")`, and delegate properties while paused.
- Confirm DebugMessages output appears for startup, timer, click, and signal transitions.
- Start and stop profiler capture while the timer and animation are active, then export the snapshot.