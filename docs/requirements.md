# QML Debug Requirements

## Target

The extension should provide Qt Creator parity for debugging QML applications from VS Code through the Debug Adapter Protocol (DAP), while bridging VS Code to the Qt QML debug services exposed by `-qmljsdebugger`.

## Qt Creator Feature Parity

- Attach to an already running Qt/QML process through host and port.
- Launch a Qt/QML process with generated `-qmljsdebugger` arguments.
- Support mixed C++ and QML workflows through VS Code compound configurations.
- Negotiate `QDeclarativeDebugClient` services and report missing required services clearly.
- Support QML breakpoints, including add, remove, verification, and hit reporting.
- Support exception breakpoints for all QML/JavaScript exceptions where the Qt service exposes them.
- Support pause, continue, step in, step out, and next.
- Show QML stack frames with mapped source paths and correct line numbering.
- Show scopes and variables, including object expansion, properties, filtering functions, sorting members, and watch/hover evaluation.
- Route Qt debug output messages to the DAP output stream with source, line, severity, category, and function metadata.
- Preserve virtual-to-physical source path mappings for `qrc:/`, filesystem paths, and generated/embedded QML where possible.
- Provide clear diagnostics for protocol, handshake, timeout, and service negotiation failures.

## Modern DAP Requirements

- Return accurate `initialize` capabilities and avoid advertising unsupported requests.
- Always answer every DAP request exactly once, including failure paths.
- Support `configurationDone` so VS Code can follow the standard initialize/configure/attach flow.
- Keep 1-based and 0-based line/column conversion correct according to client capabilities.
- Keep stable thread, stack frame, scope, variable, and breakpoint identifiers.
- Use DAP events for initialized, stopped, output, invalidated, and terminated state changes.
- Treat unsupported requests as explicit errors instead of hanging.

## Testing Requirements

- Unit-test packet serialization and parsing for Qt datastream primitives.
- Unit-test packet framing and dispatch across fragmented and combined socket payloads.
- Unit-test QML message/type guards for valid and invalid protocol objects.
- Unit-test DAP request handlers with mocked Qt debug services.
- Add coverage reporting and move toward full coverage of protocol conversion, DAP mapping, and error paths.
- Keep tests runnable without a live Qt application for protocol and DAP mapping code.
