
<img src="qml-debug.png" alt="drawing" width="200pt"/>

<p>
  <img alt="Version" src="https://img.shields.io/badge/version-0.0.1-blue.svg?cacheSeconds=2592000" />
  <img src="https://img.shields.io/badge/vscode-%5E1.54.0-blue.svg" />
  <a href="#" target="_blank">
    <img alt="License: GPL--3.0" src="https://img.shields.io/badge/License-GPL--3.0-green.svg" />
  </a>
</p>

🏠 [Homepage](https://github.com/orcun-gokbulut/qml-debug)

## <font color="red"><b>WARNING !!!</b></font>

This is a beta release. It may contain bugs and problems. 

Please be patient while using it and report back any problem you have encountered to https://github.com/orcun-gokbulut/qml-debug/issuess

Thank you for using Qml-Debug Beta.

## Description
**Short Description:** QML Debuger for VSCode.

**Detailed Description:** Debug Adapter Protocol (DAP), which is used by Visual Studio Code to interface with various debuggers, implementation for Qt QML debugger.

https://microsoft.github.io/debug-adapter-protocol/

## Usage
Both attach and launch workflows are supported.

Attach mode connects to an already running Qt/QML process that was started with `-qmljsdebugger`. Launch mode starts the target application and appends the debugger argument automatically.

### Attach Mode
Attach mode attaches Qml Debugger in the already running application instance.

**Sample launch.json Configuration:**
```json
{

    "version": "0.2.0",
    "configurations": [
        {
            "name": "QML Debug: Attach",
            "type": "qml",
            "request": "attach",
            "host": "localhost",
            "port": 12150,
            "paths": {
                "qrc:/qml-debug-test-app/qml": "${workspaceFolder}/qml"
            }
        },
    ]
}
```

**Configuration Properties**
 - **name**: Name of your configuration.
 - **type**: Type of your debugger extension. This should be qml.
 - **request** (Default: attach): Debugger mode. Only attach mode is supported for now. Therefore this should be attach.
 - **host** (Default: 127.0.0.1): Hostname/IP Address of the computer that debugee will be run.
 - **port** (Default: 12150): Port number of the debugger.
 - **paths**: List of Qml paths that will be matched to physical paths for debugger to load correct source code.


#### Mapping Virtual paths to Physical Paths
In order to Qml Debuger find your source code, you should have one or more path matching options in your configuration. These mapping tuples are contained in configuration's path property.

**Example:**
```json
"paths": {
    "qrc:/qml-debug-test-app": "${workspaceFolder}/src/qml",
    "qrc:/qml-debug-test-app/ui": "${workspaceFolder}/src/ui/qml"
}
```

#### Launching Your Application

In order to debug your Qml based application in attach mode you have to start your binary with debug parameters;

```sh
./your_qml_app -qmljsdebugger=host:127.0.0.1,port:12150,block,services:DebugMessages,QmlDebugger,V8Debugger,QmlInspector
```

These parameters will instruct Qt to load necessary debugger plugins and extensions. On launch mode Qml Debugger extension will add these paramters automaticly but in attach mode you have to add it yourself when you are launching your application by hand.

If you want Phase 4 features, include the optional services you need:

- Inspector: `QmlInspector`
- Profiler capture: `CanvasFrameRate`
- Better profiler start/stop coordination: `EngineControl`

Example with both inspector and profiler services:

```sh
./your_qml_app -qmljsdebugger=host:127.0.0.1,port:12150,block,services:DebugMessages,QmlDebugger,V8Debugger,QmlInspector,CanvasFrameRate,EngineControl
```

You can also use VSCode launch.json configuration to append the parameters by adding flowing lines to your configration;;

```json
"args": [
    "-qmljsdebugger=host:localhost,port:12150,services:DebugMessages,QmlDebugger,V8Debugger"
]
```

#### Attach with C++ Debugger
If you want use multiple debugger (C++ and Qml) at the same time you should crate compatable one Qml Debug configuıration and one cppdbg configuration then combine them into launch compound.

You should make sure that cppdbg launch configration launches application with debugging command line arguments with correct hostname and port values that matches with your Qml Debug launch configuration.

**Command Line Arguments:**

-qmljsdebugger=host:**localhost**,port:**12150**,services:DebugMessages,QmlDebugger,V8Debugger

**Launch Configuration:**

"host": **"localhost"**,<br>
"port": **12150**,


**Example compund launch configration;**
```json
{
    "version": "0.2.0",
    "configurations": [
        // C++ Launcher
        {
            "name": "C++ Debug: Launch",
            "type": "cppdbg",
            "request": "launch",
            "program": "${workspaceFolder}/your_qml_application",
            "args": [
                "-qmljsdebugger=host:localhost,port:12150,services:DebugMessages,QmlDebugger,V8Debugger"
            ]
        },
        // Qml Attacher
        {
            "name": "QML Debug: Attach",
            "type": "qml",
            "request": "attach",
            "host": "localhost",
            "port": 12150,
            "paths": {
                "qrc:/qml": "${workspaceFolder}/qml"
            }
        },
    ],
    "compounds": [
        {
          "name": "C++/QML Debug: Launch",
          "configurations": ["C++ Debug: Launch", "QML Debug: Attach"]
        }
    ]
}
```

## Inspector and Profiler Views

When a QML debug session is active, the Debug view shows two runtime panels:

- `QML Inspector` exposes service availability, interactive selection state, app-on-top state, and the currently selected runtime object ids.
- `QML Profiler` exposes capture state, requested feature mask, packet counters, byte counts, and a JSON export of the current snapshot.

Available commands:

- `QML Debug: Inspect Current QML Item`
- `QML Debug: Toggle Inspector Selection`
- `QML Debug: Toggle Inspector App On Top`
- `QML Debug: Start QML Profiler Capture`
- `QML Debug: Stop QML Profiler Capture`
- `QML Debug: Clear QML Profiler Snapshot`
- `QML Debug: Export QML Profiler Snapshot`

The profiler view currently captures and exports the negotiated profiler traffic snapshot. It does not yet decode the full Qt Creator timeline format.

## Qt Service Matrix

The extension negotiates services dynamically and degrades based on what the target runtime exposes.

- Core QML debugging requires `DebugMessages`, `QmlDebugger`, and `V8Debugger`.
- QML Inspector features require `QmlInspector`.
- Profiler capture requires `CanvasFrameRate`.
- `EngineControl` is optional, but Qt runtimes that expose it can coordinate profiler startup and shutdown more cleanly.

This means support is capability-based rather than hardcoded to a single Qt release. In practice, Qt builds that expose the legacy `QDeclarativeDebugClient` protocol with those services will work best.

## Current State
Project is still in development. Current version is fully functional but unstable with lots of potential bugs. In addition to that, there are rooms for improvements in various places.
Therefore, still work in progress...

### Initial Release Features
- [x] Qt Datastream Protocol Implementation.
- [x] Debugging and logging support tools and utilities.
- [x] Main structure of the application.
- [x] Handshaking and snakeoil code.
- [x] Breakpoints
- [x] Flow Control (Pause, Step, StepIn, StepOut, Continue)
- [x] Backtrace and Stack Viewer
- [x] Editor Variable Evaluators
- [x] Exception Breakpoints
- [x] Settings
- [x] Documentation
- [ ] Extended Documentation
- [ ] Polishing, Bugfixing, Improving Stability and Hardening for Initial Release
- [ ] Automatic Attach (Automaticly find Qml application and attach it)
- [ ] Automatic C++ Debug Launcher (Launch C++ debuger before starting Qml Debug Session)
- [ ] Automated Unit Tests

### Next Major Version Features
- [x] Qml Scene Graph Profiler and Debugger

### Really R&D Stuff (Far Future, Requires VSCode future contribution)
- [ ] Mixed Mode Debugging (Merging Qml and C++ debug sessions into one)


## Author
👤 **Y. Orçun Gökbulut**
* Website: https://www.github.com/orcun-gokbulut
* Github: [@orcun-gokbulut](https://github.com/orcun-gokbulut)


## 🤝 Contributing
Contributions, issues and feature requests are welcome!<br />Feel free to check [issues page](https://github.com/orcun-gokbulut/qml-debug/issues). You can also take a look at the [contributing guide](https://github.com/orcun-gokbulut/qml-debug/blob/master/CONTRIBUTING.md).


## Copyright & Licenese
Copyright © 2022 [Y. Orçun GÖKBULUT](https://github.com/orcun-gokbulut). All rights reserved.<br />
This project is [GPL--3.0](https://github.com/orcun-gokbulut/hex-dump/blob/master/LICENSE) licensed.
<br>
<br>


