import Log from "@qml-debug/common/log";
import ServiceDebugMessages from "@qml-debug/services/debug-messages";
import ServiceQmlDebugger, { QmlDebugObjectReference, QmlDebugObjectTreeSnapshot } from "@qml-debug/services/qml-debugger";
import ServiceNativeDebugger from "@qml-debug/services/v8-debugger";
import ServiceDeclarativeDebugClient, { NegotiatedQtDebugCapabilities } from "@qml-debug/services/declarative-debug-client";
import ServiceQmlInspector, { QmlInspectorSnapshot } from "@qml-debug/services/qml-inspector";
import ServiceQmlProfiler, { QmlProfilerExport, QmlProfilerSnapshot } from "@qml-debug/services/qml-profiler";
import { getProfilerServiceCapabilities, parseProfilerFeatureMask } from "@qml-debug/protocol/profiler-features";
import PacketManager from "@qml-debug/transport/packet-manager";
import { QmlEvent, QmlBreakEventBody, isQmlBreakEvent } from "@qml-debug/protocol/qml-messages";
import { QmlFrame, QmlVariable } from "@qml-debug/protocol/qml-types";

import path = require("path");
import { ChildProcess, spawn } from "child_process";
import * as vscode from "vscode";
import { InitializedEvent, LoggingDebugSession, Response, StoppedEvent, TerminatedEvent, Thread, StackFrame, Source, Scope, Variable, InvalidatedEvent } from "@vscode/debugadapter";
import { DebugProtocol } from "@vscode/debugprotocol";

/** A breakpoint tracked by VS Code and, once attached, synchronized to the QML V8 debug service. */
interface QmlBreakpoint
{
    /** Debugger-service breakpoint id. A value of 0 means the breakpoint is still pending remote synchronization. */
    id : number;
    /** Physical source path used by VS Code. */
    filename : string;
    /** Client-facing DAP line number. */
    line : number;
}

/** Attach configuration accepted by the QML debug adapter. */
interface QmlDebugSessionAttachArguments extends DebugProtocol.AttachRequestArguments
{
    /** Hostname or IP address where the Qt QML debug server listens. */
    host : string;
    /** TCP port where the Qt QML debug server listens. */
    port : number;
    /** Mapping from virtual QML paths such as qrc:/qml to local filesystem folders. */
    paths : { [key: string] : string };
}

/** Launch configuration accepted by the QML debug adapter. */
interface QmlDebugSessionLaunchArguments extends DebugProtocol.LaunchRequestArguments
{
    /** Executable Qt/QML application path. */
    program : string;
    /** Application arguments supplied before the generated QML debugger argument. */
    args? : string[];
    /** Working directory for the launched application. */
    cwd? : string;
    /** Extra environment variables for the launched application. */
    env? : { [key: string] : string };
    /** Hostname or IP address where the Qt QML debug server will listen. */
    host? : string;
    /** TCP port where the Qt QML debug server will listen. */
    port? : number;
    /** Virtual-to-physical source path mappings. */
    paths? : { [key: string] : string };
    /** Qt debug services requested from `-qmljsdebugger`. */
    services? : string[];
    /** Whether to add `block` so the application waits for the debugger before running QML. */
    block? : boolean;
}

/** Process launch request created from a DAP launch configuration. */
interface LaunchProcessOptions
{
    /** Executable to start. */
    program : string;
    /** Final argv passed to the executable. */
    args : string[];
    /** Optional process working directory. */
    cwd? : string;
    /** Optional environment variable overrides. */
    env? : NodeJS.ProcessEnv;
}

/** Function used to start the debuggee process; injectable for tests. */
type ProcessLauncher = (options : LaunchProcessOptions) => ChildProcess;

const DEFAULT_QML_DEBUG_SERVICES = [ "DebugMessages", "QmlDebugger", "V8Debugger", "QmlInspector" ];

/** Common lifecycle methods implemented by every Qt debug service wrapper. */
interface DebugLifecycleService
{
    /** Prepare service state before a debug connection is opened. */
    initialize() : Promise<void>;
    /** Release service state before the debug connection is closed. */
    deinitialize() : Promise<void>;
}

/** QDeclarativeDebugClient bridge used for service negotiation. */
interface DeclarativeDebugClientService extends DebugLifecycleService
{
    /** Perform the Qt debug server handshake and service negotiation. */
    handshake() : Promise<void>;
    /** Return the last negotiated Qt debug service list and protocol metadata. */
    getCapabilities() : NegotiatedQtDebugCapabilities;
    /** Return true when the negotiated service list contains the requested service. */
    isServiceAvailable(name : string) : boolean;
}

/** Minimal QmlDebugger surface used for inspector source lookups. */
interface QmlDebuggerService extends DebugLifecycleService
{
    /** Query the objects declared at a source location. */
    requestObjectsForLocation(filename : string, lineNumber : number, columnNumber : number) : Promise<QmlDebugObjectReference[]>;
    /** Return decoded object trees and context groupings for the requested runtime ids. */
    requestObjectTreeSnapshot(objectIds : number[]) : Promise<QmlDebugObjectTreeSnapshot>;
}

/** Optional QmlInspector service surface exposed through custom DAP requests. */
interface InspectorService extends DebugLifecycleService
{
    /** Return the current inspector state. */
    getSnapshot() : QmlInspectorSnapshot;
    /** Enable or disable interactive selection in the target app. */
    setInspectToolEnabled(enabled : boolean) : Promise<QmlInspectorSnapshot>;
    /** Toggle Qt's app-on-top window flag while inspector tools are active. */
    setShowAppOnTop(showAppOnTop : boolean) : Promise<QmlInspectorSnapshot>;
    /** Select the provided runtime object ids in the Qt inspector. */
    selectObjects(objectIds : number[]) : Promise<QmlInspectorSnapshot>;
}

/** Optional profiler capture surface used for Phase 4 control and collection. */
interface ProfilerService extends DebugLifecycleService
{
    /** Return the current profiler snapshot. */
    getSnapshot() : QmlProfilerSnapshot;
    /** Return a structured export of captured profiler traffic. */
    exportSnapshot() : QmlProfilerExport;
    /** Start recording profiler traffic with the requested feature mask. */
    startRecording(featureMask : bigint, flushInterval : number) : Promise<QmlProfilerSnapshot>;
    /** Stop profiler recording. */
    stopRecording() : Promise<QmlProfilerSnapshot>;
    /** Clear accumulated profiler packets and counters. */
    clear() : QmlProfilerSnapshot;
}

/** Minimal V8 debugger service surface used by the DAP adapter. */
interface V8DebuggerService extends DebugLifecycleService
{
    /** Complete V8 debugger service negotiation after the transport is connected. */
    handshake() : Promise<void>;
    /** Disconnect the V8 debugger service. */
    disconnect() : Promise<void>;
    /** Install a source breakpoint in the QML/JS runtime. */
    requestSetBreakpoint(filenameParam : string, lineParam : number) : Promise<any>;
    /** Remove a source breakpoint from the QML/JS runtime. */
    requestClearBreakpoint(idParam : number) : Promise<any>;
    /** Configure exception break mode. */
    requestSetExceptionBreakpoint(typeParam : string, enabledParam : boolean) : Promise<any>;
    /** Request the current QML/JS stack trace. */
    requestBacktrace() : Promise<any>;
    /** Request a stack frame and its scope references. */
    requestFrame(frameId : number) : Promise<any>;
    /** Request a concrete scope object. */
    requestScope(scopeId : number) : Promise<any>;
    /** Request object details for one or more QML handles. */
    requestLookup(handlesParam : number[]) : Promise<any>;
    /** Evaluate an expression in a stack frame. */
    requestEvaluate(frameId : number, expressionParam : string) : Promise<any>;
    /** Continue execution, optionally with a step action. */
    requestContinue(stepAction? : "in" | "out" | "next", stepCount? : 1) : Promise<any>;
    /** Interrupt the running QML/JS runtime when the Qt service supports it. */
    requestPause() : Promise<any>;
}

/** Optional constructor dependencies used by unit tests to replace Qt services with mocks. */
interface QmlDebugSessionDependencies
{
    /** Packet transport between the adapter and the Qt debug server. */
    packetManager? : PacketManager;
    /** QmlDebugger service wrapper. */
    qmlDebugger? : QmlDebuggerService;
    /** DebugMessages service wrapper. */
    debugMessages? : DebugLifecycleService;
    /** V8Debugger service wrapper. */
    v8debugger? : V8DebuggerService;
    /** QDeclarativeDebugClient service wrapper. */
    declarativeDebugClient? : DeclarativeDebugClientService;
    /** QmlInspector service wrapper. */
    inspector? : InspectorService;
    /** CanvasFrameRate profiler service wrapper. */
    profiler? : ProfilerService;
    /** Process launcher used by launch mode. */
    processLauncher? : ProcessLauncher;
}

/** Convert a Qt/V8 scope type id into a human-readable DAP scope name. */
function convertScopeName(type : number) : string
{
    switch (type)
    {
        default:
        case -1:
            return "Qml Context";

        case 0:
            return "Globals";

        case 1:
            return "Arguments";

        case 2:
        case 4:
            return "Locals";
    }
}

/** Convert a Qt/V8 scope type id into a DAP presentation hint. */
function convertScopeType(type : number) : string
{
    switch (type)
    {
        default:
        case 0:
            return "globals";

        case 1:
            return "arguments";

        case 2:
        case 4:
            return "locals";
    }
}

/** Return true when a path uses a Qt virtual scheme that must not be normalized as a host filesystem path. */
function isVirtualQmlPath(filename : string) : boolean
{
    return /^qrc:\//i.test(filename) || /^file:\//i.test(filename);
}

/** Normalize a QML virtual path to stable slash separators and no trailing slash. */
function normalizeVirtualPath(filename : string) : string
{
    let normalized = filename.replace(/\\/g, "/");
    while (normalized.length > "qrc:/".length && normalized.endsWith("/"))
        normalized = normalized.slice(0, -1);

    return normalized;
}

/** Normalize a local filesystem path for prefix comparisons. */
function normalizePhysicalPath(filename : string) : string
{
    return path.normalize(filename).replace(/\\/g, "/").replace(/\/+$/, "");
}

/** Normalize either a QML virtual path or a local filesystem path. */
function normalizeSourcePath(filename : string) : string
{
    return isVirtualQmlPath(filename) ? normalizeVirtualPath(filename) : normalizePhysicalPath(filename);
}

/** Return true when candidate equals base or is a child path of base. */
function startsWithPath(candidate : string, base : string) : boolean
{
    return candidate === base || candidate.startsWith(base + "/");
}

export class QmlDebugSession extends LoggingDebugSession
{
    /** Packet transport used by all Qt debug services. */
    private packetManager_ : PacketManager;
    /** QmlDebugger service wrapper. */
    private qmlDebugger : QmlDebuggerService;
    /** DebugMessages service wrapper. */
    private debugMessages : DebugLifecycleService;
    /** V8Debugger service wrapper that powers QML/JS debugging. */
    private v8debugger : V8DebuggerService;
    /** Declarative debug client used for the initial Qt handshake. */
    private declarativeDebugClient : DeclarativeDebugClientService;
    /** Optional QmlInspector service used by Phase 4 commands. */
    private inspector : InspectorService;
    /** Optional CanvasFrameRate profiler service used by Phase 4 commands. */
    private profiler : ProfilerService;

    /** Whether the runtime is currently paused in QML/JS code. */
    private breaked = false;
    /** Breakpoints requested by VS Code and synchronized to the Qt debug service when connected. */
    private breakpoints : QmlBreakpoint[] = [];
    /** Virtual-to-physical source path mappings from launch configuration. */
    private pathMappings = new Map<string, string>([]);
    /** True when the client sends 0-based lines. */
    private linesStartFromZero = false;
    /** True when the client sends 0-based columns. */
    protected columnsStartFromZero = false;
    /** Whether function-valued object properties should be hidden in variable views. */
    private filterFunctions = true;
    /** Whether object members should be sorted by name before returning variables. */
    private sortMembers = true;
    /** True after the Qt debug service handshake has completed. */
    private debuggerConnected = false;
    /** Process started by launch mode, if this session owns one. */
    private launchedProcess? : ChildProcess;
    /** Process launcher used by launch mode. */
    private processLauncher : ProcessLauncher;

    public get packetManager() : PacketManager
    {
        return this.packetManager_;
    }

    public get mainQmlThreadId() : number
    {
        return 1;
    }

    /** Replace the active virtual-to-physical path mapping table. */
    public setPathMappings(paths : { [key: string] : string } | undefined) : void
    {
        const mappings = Object.entries(paths ?? {})
            .filter((entry) : boolean => { return entry[1] !== null && entry[1] !== undefined; })
            .map<[string, string]>((entry) : [string, string] =>
            {
                return [ normalizeVirtualPath(entry[0]), normalizePhysicalPath(entry[1]) ];
            })
            .sort((a, b) : number => { return b[0].length - a[0].length; });

        this.pathMappings = new Map(mappings);
    }

    /** Convert a local VS Code source path into the virtual path understood by the Qt debug service. */
    public mapPathTo(filename : string) : string
    {
        const normalized = normalizeSourcePath(filename);
        if (isVirtualQmlPath(normalized))
            return normalized;

        for (const [ virtualPath, physicalPath ] of this.pathMappings)
        {
            if (startsWithPath(normalized, physicalPath))
            {
                const relativePath = normalized.slice(physicalPath.length).replace(/^\//, "");
                return relativePath === "" ? virtualPath : virtualPath + "/" + relativePath;
            }
        }

        return path.parse(normalized).base;
    }

    /** Convert a Qt virtual source path into a local VS Code filesystem path where mapping exists. */
    public mapPathFrom(filename : string) : string
    {
        const normalized = normalizeSourcePath(filename);
        for (const [ virtualPath, physicalPath ] of this.pathMappings)
        {
            if (startsWithPath(normalized, virtualPath))
            {
                const relativePath = normalized.slice(virtualPath.length).replace(/^\//, "");
                return relativePath === "" ? physicalPath : path.join(physicalPath, relativePath);
            }
        }

        return normalized;
    }

    /** Convert a DAP line number into the line numbering expected by Qt/V8. */
    public mapLineNumberTo(lineNumber : number) : number
    {
        return (this.linesStartFromZero ? lineNumber : lineNumber - 1);
    }

    /** Convert a Qt/V8 line number into the line numbering expected by the DAP client. */
    public mapLineNumberFrom(lineNumber : number) : number
    {
        return (this.linesStartFromZero ? lineNumber : lineNumber + 1);
    }

    /** Convert a DAP column number into the column numbering expected by Qt/V8. */
    public mapColumnTo(column : number) : number
    {
        return (this.columnsStartFromZero ? column : column - 1);
    }

    /** Convert a Qt/V8 column number into the column numbering expected by the DAP client. */
    public mapColumnFrom(column : number) : number
    {
        return (this.columnsStartFromZero ? column : column + 1);
    }

    /** Convert a DAP variablesReference into the raw Qt/V8 object handle. */
    public mapHandleTo(handle : number) : number
    {
        return handle - 1;
    }

    /** Convert a raw Qt/V8 object handle into a DAP variablesReference. */
    public mapHandleFrom(handle : number) : number
    {
        return handle + 1;
    }

    /** Build a stable snapshot of the negotiated Qt services and feature availability. */
    public getQtCapabilitiesSnapshot() : {
        protocolVersion : number;
        dataStreamVersion : number;
        services : { name : string; version : number; available : boolean }[];
        inspectorAvailable : boolean;
        profilerAvailable : boolean;
        profilerBackend : string;
        profilerEngineControlAvailable : boolean;
    }
    {
        const capabilities = this.declarativeDebugClient.getCapabilities();
        const profilerCapabilities = getProfilerServiceCapabilities(capabilities.services.map((service) : string => { return service.name; }));

        return {
            protocolVersion: capabilities.protocolVersion,
            dataStreamVersion: capabilities.dataStreamVersion,
            services: capabilities.services.map((service) =>
            {
                return {
                    name: service.name,
                    version: service.version,
                    available: true
                };
            }),
            inspectorAvailable: this.declarativeDebugClient.isServiceAvailable("QmlInspector"),
            profilerAvailable: profilerCapabilities.profilerAvailable,
            profilerBackend: profilerCapabilities.backend,
            profilerEngineControlAvailable: profilerCapabilities.engineControlAvailable
        };
    }

    /** Validate that a single Qt service is available before handling a custom request. */
    private requireQtService(response : DebugProtocol.Response, serviceName : string, errorNo : number) : boolean
    {
        return this.requireQtServices(response, [ serviceName ], errorNo);
    }

    /** Validate that every required Qt service is available before handling a custom request. */
    private requireQtServices(response : DebugProtocol.Response, serviceNames : string[], errorNo : number) : boolean
    {
        const missingServices = serviceNames.filter((serviceName) : boolean =>
        {
            return !this.declarativeDebugClient.isServiceAvailable(serviceName);
        });

        if (missingServices.length === 0)
            return true;

        this.sendErrorResponse(response,
            {
                id: errorNo,
                format: "QML Debug: Required Qt debug service" + (missingServices.length > 1 ? "s " : " ")
                    + missingServices.map((serviceName) : string => { return "'" + serviceName + "'"; }).join(", ")
                    + " " + (missingServices.length > 1 ? "are" : "is") + " not available in the active session.",
                showUser: true
            }
        );
        return false;
    }

    private mapInspectorSourcePath(filename : string) : string
    {
        const mappedPath = this.mapPathTo(filename);
        if (mappedPath !== path.parse(normalizeSourcePath(filename)).base)
            return mappedPath.replace(/\\/g, "/");

        return normalizeSourcePath(filename);
    }

    private getInspectorStatusResponse() : QmlInspectorSnapshot & { available : boolean }
    {
        return {
            available: this.declarativeDebugClient.isServiceAvailable("QmlInspector"),
            ...this.inspector.getSnapshot()
        };
    }

    private getProfilerStatusResponse() : QmlProfilerSnapshot & { available : boolean; engineControlAvailable : boolean; backend : string }
    {
        const profilerCapabilities = getProfilerServiceCapabilities(
            this.declarativeDebugClient.getCapabilities().services.map((service) : string => { return service.name; })
        );

        return {
            available: profilerCapabilities.profilerAvailable,
            engineControlAvailable: profilerCapabilities.engineControlAvailable,
            backend: profilerCapabilities.backend,
            ...this.profiler.getSnapshot()
        };
    }

    /** Tear down any partially initialized transport state after attach, launch, or disconnect failures. */
    private async cleanupConnection(stopLaunchedProcess : boolean) : Promise<void>
    {
        this.debuggerConnected = false;

        await this.v8debugger.deinitialize().catch(() : void => undefined);
        await this.profiler.deinitialize().catch(() : void => undefined);
        await this.inspector.deinitialize().catch(() : void => undefined);
        await this.qmlDebugger.deinitialize().catch(() : void => undefined);
        await this.declarativeDebugClient.deinitialize().catch(() : void => undefined);
        await this.packetManager.disconnect().catch(() : void => undefined);

        if (stopLaunchedProcess && this.launchedProcess !== undefined && !this.launchedProcess.killed)
            this.launchedProcess.kill();

        if (stopLaunchedProcess)
            this.launchedProcess = undefined;
    }

    private async handleCustomRequest(command : string, response : DebugProtocol.Response, args : any) : Promise<void>
    {
        if (command === "qml/getCapabilities")
        {
            response.body = this.getQtCapabilitiesSnapshot();
            this.sendResponse(response);
            return;
        }

        if (command === "qml/inspector/status")
        {
            response.body = this.getInspectorStatusResponse();
            this.sendResponse(response);
            return;
        }

        if (command === "qml/inspector/setEnabled")
        {
            if (!this.requireQtService(response, "QmlInspector", 1006))
                return;

            response.body = await this.inspector.setInspectToolEnabled(Boolean(args?.enabled));
            this.sendResponse(response);
            return;
        }

        if (command === "qml/inspector/setShowAppOnTop")
        {
            if (!this.requireQtService(response, "QmlInspector", 1006))
                return;

            response.body = await this.inspector.setShowAppOnTop(Boolean(args?.showAppOnTop));
            this.sendResponse(response);
            return;
        }

        if (command === "qml/inspector/selectObjects")
        {
            if (!this.requireQtService(response, "QmlInspector", 1006))
                return;

            const objectIds = Array.isArray(args?.objectIds)
                ? args.objectIds.filter((value : unknown) : value is number => { return typeof value === "number"; })
                : [];
            response.body = await this.inspector.selectObjects(objectIds);
            this.sendResponse(response);
            return;
        }

        if (command === "qml/inspector/selectBySource")
        {
            if (!this.requireQtServices(response, [ "QmlInspector", "QmlDebugger" ], 1006))
                return;

            const filename = typeof args?.path === "string" ? args.path : "";
            const lineNumber = typeof args?.line === "number" ? args.line : 1;
            const columnNumber = typeof args?.column === "number" ? args.column : 1;
            const matches = await this.qmlDebugger.requestObjectsForLocation(
                this.mapInspectorSourcePath(filename),
                lineNumber,
                columnNumber
            );
            const objectIds = matches.map((value) : number => { return value.debugId; }).filter((value) : boolean => { return value >= 0; });
            const snapshot = objectIds.length > 0 ? await this.inspector.selectObjects(objectIds) : this.inspector.getSnapshot();
            response.body = {
                matchedObjectIds: objectIds,
                inspector: snapshot
            };
            this.sendResponse(response);
            return;
        }

        if (command === "qml/inspector/objectTree")
        {
            if (!this.requireQtService(response, "QmlDebugger", 1009))
                return;

            const requestedObjectIds = Array.isArray(args?.objectIds)
                ? args.objectIds.filter((value : unknown) : value is number => { return typeof value === "number"; })
                : this.inspector.getSnapshot().currentObjectIds;

            response.body = await this.qmlDebugger.requestObjectTreeSnapshot(requestedObjectIds);
            this.sendResponse(response);
            return;
        }

        if (command === "qml/profiler/status")
        {
            response.body = this.getProfilerStatusResponse();
            this.sendResponse(response);
            return;
        }

        if (command === "qml/profiler/start")
        {
            if (!this.requireQtService(response, "CanvasFrameRate", 1007))
                return;

            const flushInterval = typeof args?.flushInterval === "number" && Number.isFinite(args.flushInterval)
                ? Math.max(1, Math.trunc(args.flushInterval))
                : 250;
            response.body = await this.profiler.startRecording(parseProfilerFeatureMask(args?.featureMask ?? args?.features), flushInterval);
            this.sendResponse(response);
            return;
        }

        if (command === "qml/profiler/stop")
        {
            if (!this.requireQtService(response, "CanvasFrameRate", 1007))
                return;

            response.body = await this.profiler.stopRecording();
            this.sendResponse(response);
            return;
        }

        if (command === "qml/profiler/clear")
        {
            if (!this.requireQtService(response, "CanvasFrameRate", 1007))
                return;

            response.body = this.profiler.clear();
            this.sendResponse(response);
            return;
        }

        if (command === "qml/profiler/export")
        {
            if (!this.requireQtService(response, "CanvasFrameRate", 1007))
                return;

            response.body = this.profiler.exportSnapshot();
            this.sendResponse(response);
            return;
        }

        super.customRequest(command, response, args);
    }

    /** Send a DAP error response and optionally terminate the debug session. */
    private sendQmlError(response : Response, errorNo : number, errorText : string, terminate : boolean) : void
    {
        this.sendErrorResponse(response,
            {
                id: errorNo,
                format: "QML Debug: " + errorText,
                showUser: true
            }
        );

        if (terminate)
            this.sendEvent(new TerminatedEvent());
    }

    /** Send a fatal DAP error and terminate the session. */
    private raiseError(response : Response, errorNo : number, errorText : string) : void
    {
        this.sendQmlError(response, errorNo, errorText, true);
    }

    /** Send a recoverable DAP request error without terminating the session. */
    private failRequest(response : Response, errorNo : number, errorText : string) : void
    {
        this.sendQmlError(response, errorNo, errorText, false);
    }

    /** Push locally known breakpoints that do not yet have a Qt debugger id to the active debug service. */
    private async synchronizeBreakpoints() : Promise<void>
    {
        for (const current of this.breakpoints)
        {
            if (current.id !== 0)
                continue;

            const result = await this.v8debugger.requestSetBreakpoint(this.mapPathTo(current.filename), this.mapLineNumberTo(current.line));
            if (!result.success)
                throw new Error("Cannot synchronize breakpoint " + current.filename + ":" + current.line + ".");

            current.id = result.body.breakpoint;
        }
    }

    /** Build the `-qmljsdebugger` argument Qt expects for QML debugging. */
    public buildQmlDebuggerArgument(args : QmlDebugSessionLaunchArguments) : string
    {
        const host = args.host ?? "localhost";
        const port = args.port ?? 12150;
        const services = args.services ?? DEFAULT_QML_DEBUG_SERVICES;
        const fragments = [ "host:" + host, "port:" + port ];

        if (args.block !== false)
            fragments.push("block");

        fragments.push("services:" + services.join(","));

        return "-qmljsdebugger=" + fragments.join(",");
    }

    /** Start the debuggee process for launch mode and return once the process has been spawned. */
    private launchDebuggee(args : QmlDebugSessionLaunchArguments) : void
    {
        const applicationArgs = (args.args ?? []).filter((current) : boolean => { return !current.startsWith("-qmljsdebugger="); });
        const finalArgs = [ ...applicationArgs, this.buildQmlDebuggerArgument(args) ];
        const environment = args.env === undefined ? process.env : { ...process.env, ...args.env };

        this.launchedProcess = this.processLauncher(
            {
                program: args.program,
                args: finalArgs,
                cwd: args.cwd,
                env: environment
            }
        );

        this.launchedProcess.once("exit", () =>
        {
            this.debuggerConnected = false;
            this.sendEvent(new TerminatedEvent());
        });
    }

    /** Handle asynchronous Qt/V8 runtime events and translate them into DAP events. */
    public onEvent(event : QmlEvent<any>) : void
    {
        if (event.event === "break")
        {
            if (!isQmlBreakEvent(event))
                return;

            const breakEvent : QmlBreakEventBody = event.body as QmlBreakEventBody;
            const filename = this.mapPathFrom(breakEvent.script.name);
            const breakpointIds : number[] = [];
            for (let i = 0; i < this.breakpoints.length; i++)
            {
                const current = this.breakpoints[i];
                if (current.filename === filename && current.line === this.mapLineNumberFrom(breakEvent.sourceLine))
                    breakpointIds.push(current.id);
            }

            this.breaked = true;

            if (breakpointIds.length === 0)
            {
                this.sendEvent(new StoppedEvent("step", this.mainQmlThreadId));
            }
            else
            {
                const stoppedEvent : DebugProtocol.StoppedEvent = new StoppedEvent("breakpoint", this.mainQmlThreadId);
                stoppedEvent.body.hitBreakpointIds = breakpointIds;
                stoppedEvent.body.description = "Breakpoint hit at " + filename + " on line(s) " + breakpointIds + ".";
                this.sendEvent(stoppedEvent);
            }
        }

    }

    protected async initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): Promise<void>
    {
        Log.trace("QmlDebugSession.initializeRequest", [ response, args ]);

        this.linesStartFromZero = !args.linesStartAt1;
        this.columnsStartFromZero = !args.columnsStartAt1;

        response.body = {};
        response.body.supportsConfigurationDoneRequest = true;
        response.body.supportsFunctionBreakpoints = false;
        response.body.supportsConditionalBreakpoints = false;
        response.body.supportsHitConditionalBreakpoints = false;
        response.body.supportsEvaluateForHovers = true;
        response.body.exceptionBreakpointFilters = [
            {
                label: "All Exceptions",
                filter: "all",
            },
            {
                label: "Uncaught Exceptions",
                filter: "uncaught",
            }
        ];
        response.body.supportsStepBack = false;
        /*WILL BE IMPLEMENTED*/response.body.supportsSetVariable = false;
        response.body.supportsRestartFrame = false;
        response.body.supportsGotoTargetsRequest = false;
        response.body.supportsStepInTargetsRequest = false;
        response.body.supportsCompletionsRequest = false;
        response.body.completionTriggerCharacters = [];
        response.body.supportsModulesRequest = false;
        response.body.additionalModuleColumns = [];
        response.body.supportedChecksumAlgorithms = [];
        response.body.supportsRestartRequest = false;
        /*WILL BE IMPLEMENTED*/response.body.supportsExceptionOptions = false;
        /*WILL BE IMPLEMENTED*/response.body.supportsValueFormattingOptions = false;
        /*WILL BE IMPLEMENTED*/response.body.supportsExceptionInfoRequest = false;
        response.body.supportTerminateDebuggee = false;
        response.body.supportSuspendDebuggee = false;
        /*WILL BE IMPLEMENTED*/response.body.supportsDelayedStackTraceLoading = true;
        response.body.supportsLoadedSourcesRequest = false;
        /*WILL BE IMPLEMENTED*/response.body.supportsLogPoints = false;
        response.body.supportsTerminateThreadsRequest = false;
        /*WILL BE IMPLEMENTED*/response.body.supportsSetExpression = false;
        response.body.supportsTerminateRequest = false;
        response.body.supportsDataBreakpoints = false;
        response.body.supportsReadMemoryRequest = false;
        response.body.supportsWriteMemoryRequest = false;
        response.body.supportsDisassembleRequest = false;
        /*WILL BE IMPLEMENTED*/response.body.supportsCancelRequest = false;
        /*WILL BE IMPLEMENTED*/response.body.supportsBreakpointLocationsRequest = false;
        response.body.supportsClipboardContext = false;
        response.body.supportsSteppingGranularity = false;
        response.body.supportsInstructionBreakpoints = false;
        response.body.supportsExceptionFilterOptions = false;
        response.body.supportsSingleThreadExecutionRequests = false;

        try
        {
            await this.debugMessages.initialize();
            await this.qmlDebugger.initialize();
            await this.v8debugger.initialize();
            await this.declarativeDebugClient.initialize();
            await this.inspector.initialize();
            await this.profiler.initialize();
        }
        catch (error)
        {
            this.raiseError(response, 1001, "Cannot initialize. " + error);
            return;
        }


        this.sendResponse(response);
    }

    protected async launchRequest(response: DebugProtocol.LaunchResponse, args: QmlDebugSessionLaunchArguments, request?: DebugProtocol.Request) : Promise<void>
    {
        Log.trace("QmlDebugSession.launchRequest", [ response, args, request ]);

        if (args.program === undefined || args.program === "")
        {
            this.failRequest(response, 1003, "Launch requires a program path.");
            return;
        }

        this.packetManager.host = args.host ?? "localhost";
        this.packetManager.port = args.port ?? 12150;
        this.setPathMappings(args.paths);

        try
        {
            this.launchDebuggee(args);
            await this.packetManager.connect();
            await this.declarativeDebugClient.handshake();
            await this.v8debugger.handshake();
            this.debuggerConnected = true;
            await this.synchronizeBreakpoints();
            this.sendResponse(response);
        }
        catch (error)
        {
            await this.cleanupConnection(true);
            this.raiseError(response, 1003, "Cannot launch QML debuggee. Program: " + args.program + ". " + error);
            return;
        }

        this.sendEvent(new InitializedEvent());
    }

    protected async configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments, request?: DebugProtocol.Request): Promise<void>
    {
        Log.trace("QmlDebugSession.configurationDoneRequest", [ response, args, request ]);

        this.sendResponse(response);
    }

    protected async attachRequest(response: DebugProtocol.AttachResponse, args: QmlDebugSessionAttachArguments, request?: DebugProtocol.Request): Promise<void>
    {
        Log.trace("QmlDebugSession.attachRequest", [ response, args, request ]);

        this.packetManager.host = args.host;
        this.packetManager.port = args.port;
        if (args.paths !== undefined)
            this.setPathMappings(args.paths);

        try
        {
            await this.packetManager.connect();
            await this.declarativeDebugClient.handshake();
            await this.v8debugger.handshake();
            this.debuggerConnected = true;
            await this.synchronizeBreakpoints();
            this.sendResponse(response);
        }
        catch (error)
        {
            await this.cleanupConnection(false);
            this.raiseError(response, 1002, "Cannot connect to Qml debugger. \n\tHost: " + this.packetManager.host + "\n\tPort:" + this.packetManager.port + "\n\t" + error);
            return;
        }

        this.sendEvent(new InitializedEvent());
    }

    protected async disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments, request?: DebugProtocol.Request): Promise<void>
    {
        await this.v8debugger.requestContinue().catch(() : void => undefined);
        await this.v8debugger.disconnect().catch(() : void => undefined);
        await this.cleanupConnection(true);
        this.sendResponse(response);
    }

    protected async setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments, request?: DebugProtocol.Request): Promise<void>
    {
        Log.trace("QmlDebugSession.setBreakPointsRequest", [ response, args, request ]);

        const sourcePath = args.source.path;
        const requestedBreakpoints = args.breakpoints ?? [];

        if (sourcePath === undefined)
        {
            this.sendErrorResponse(response,
                {
                    id: 1005,
                    format: "QML Debug: Cannot set breakpoints without a source path.",
                    showUser: true
                }
            );
            return;
        }

        for (let i = 0; i < this.breakpoints.length; i++)
        {
            const currentExisting = this.breakpoints[i];

            let found = false;
            for (let n = 0; n < requestedBreakpoints.length; n++)
            {
                const current = requestedBreakpoints[n];
                if (currentExisting.filename === sourcePath && currentExisting.line === current.line)
                {
                    found = true;
                    break;
                }
            }

            if (!found)
            {
                this.breakpoints.splice(i, 1);
                i--;

                if (!this.debuggerConnected || currentExisting.id === 0)
                    continue;

                try
                {
                    const result = await this.v8debugger.requestClearBreakpoint(currentExisting.id);
                    if (!result.success)
                    {
                        response.success = false;
                        this.sendResponse(response);
                        return;
                    }
                }
                catch (error)
                {
                    this.failRequest(response, 1005, "Request failed. Request: \"removebreakpoint\". " + error);
                    return;
                }
            }
        }

        for (let i = 0; i < requestedBreakpoints.length; i++)
        {
            const current = requestedBreakpoints[i];

            let found = false;
            for (let n = 0; n < this.breakpoints.length; n++)
            {
                const currentExisting = this.breakpoints![n];
                if (currentExisting.filename === sourcePath &&
                    currentExisting.line === current.line)
                {
                    found = true;
                    break;
                }
            }

            if (found)
                continue;


            let breakpointId = 0;

            if (this.debuggerConnected)
            {
                try
                {
                    const result = await this.v8debugger.requestSetBreakpoint(this.mapPathTo(sourcePath), this.mapLineNumberTo(current.line));
                    if (!result.success)
                    {
                        response.success = false;
                        this.sendResponse(response);
                        return;
                    }

                    breakpointId = result.body.breakpoint;
                }
                catch (error)
                {
                    this.failRequest(response, 1005, "Request failed. Request: \"setbreakpoint\". " + error);
                    return;
                }
            }

            const newBreakpoint : QmlBreakpoint =
            {
                id: breakpointId,
                filename: sourcePath,
                line: current.line,
            };
            this.breakpoints.push(newBreakpoint);
        }

        response.body =
        {
            breakpoints: this.breakpoints
                .filter((value) : boolean => { return value.filename === sourcePath; })
                .map<DebugProtocol.Breakpoint>(
                    (value, index, array) : DebugProtocol.Breakpoint =>
                    {
                        const breakpoint : DebugProtocol.Breakpoint =
                        {
                            id: value.id,
                            line: value.line,
                            verified: value.id !== 0,
                            message: value.id === 0 ? "Pending QML debugger attach." : undefined
                        };
                        return breakpoint;
                    }
                )
        };

        this.sendResponse(response);
    }

    protected async setExceptionBreakPointsRequest(response: DebugProtocol.SetExceptionBreakpointsResponse, args: DebugProtocol.SetExceptionBreakpointsArguments, request?: DebugProtocol.Request): Promise<void>
    {
        Log.trace("QmlDebugSession.setExceptionBreakPointsRequest", [ response, args, request ]);

        try
        {
            const filters = new Set(args.filters);
            const allResult = await this.v8debugger.requestSetExceptionBreakpoint("all", filters.has("all"));
            const uncaughtResult = await this.v8debugger.requestSetExceptionBreakpoint("uncaught", filters.has("uncaught"));
            if (!allResult.success || !uncaughtResult.success)
                response.success = false;

            this.sendResponse(response);
        }
        catch (error)
        {
            this.failRequest(response, 1005, "Request failed. Request: \"setexceptionbreak\". " + error);
        }

    }

    protected async threadsRequest(response: DebugProtocol.ThreadsResponse, request?: DebugProtocol.Request): Promise<void>
    {
        Log.trace("QmlDebugSession.threadsRequest", [ response, request ]);

        response.body =
        {
            threads: [
                new Thread(this.mainQmlThreadId, "Qml Thread")
            ]
        };
        this.sendResponse(response);
    }

    protected async stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments, request?: DebugProtocol.Request): Promise<void>
    {
        Log.trace("QmlDebugSession.continueRequest", [ response, args, request ]);

        try
        {
            const result = await this.v8debugger.requestBacktrace();
            if (!result.success)
            {
                response.success = false;
                this.sendResponse(response);
                return;
            }

            const backtrace = result.body;
            const frames = backtrace.frames as QmlFrame[];
            let frameCount = 0;
            response.body =
            {
                stackFrames: frames
                    .filter(
                        (value, index, array) =>
                        {
                            if (args.startFrame !== undefined)
                            {
                                if (index < args.startFrame)
                                    return false;
                            }

                            if (args.levels !== undefined)
                            {
                                if (frameCount >= args.levels)
                                    return false;

                                frameCount++;
                            }

                            return true;
                        }
                    )
                    .map<StackFrame>(
                        (frame, index, array) =>
                        {
                            const physicalPath = this.mapPathFrom(frame.script);
                            const parsedPath = path.parse(physicalPath);
                            return new StackFrame(frame.index, frame.func, new Source(parsedPath.base, physicalPath), this.mapLineNumberFrom(frame.line));
                        }
                    )
            };
            response.body.totalFrames = frames.length;

            this.sendResponse(response);
        }
        catch (error)
        {
            this.failRequest(response, 1005, "Request failed. Request: \"backtrace\". " + error);
        }
    }

    protected async scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments, request?: DebugProtocol.Request): Promise<void>
    {
        Log.trace("QmlDebugSession.scopesRequest", [ response, args, request ]);

        try
        {
            const result = await this.v8debugger.requestFrame(args.frameId);
            if (!result.success)
            {
                response.success = false;
                this.sendResponse(response);
                return;
            }

            const frame = result.body;
            response.body =
            {
                scopes: []
            };

            for (const scopeRef of frame.scopes)
            {
                const scopeResult = await this.v8debugger.requestScope(scopeRef.index);
                if (!scopeResult.success)
                {
                    response.success = false;
                    /* eslint-disable */
                    throw new Error("Cannot make scope request. ScopeId: " + scopeRef);
                    /* eslint-enable */
                }

                const scope = scopeResult.body;
                const dapScope : DebugProtocol.Scope = new Scope(convertScopeName(scope.type), scope.index, false);

                if (scope.object === undefined)
                    continue;

                if (scope.object.value === 0)
                    continue;

                dapScope.presentationHint = convertScopeType(scope.type);
                dapScope.variablesReference = this.mapHandleFrom(scope.object!.handle);
                dapScope.namedVariables = scope.object?.value;

                response.body.scopes.push(dapScope);
            }

            this.sendResponse(response);
        }
        catch (error)
        {
            this.failRequest(response, 1005, "Request failed. Request: \"scope\". " + error);
        }
    }

    protected async variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments, request?: DebugProtocol.Request): Promise<void>
    {
        Log.trace("QmlDebugSession.variablesRequest", [ response, args, request ]);

        try
        {
            const result = await this.v8debugger.requestLookup([ this.mapHandleTo(args.variablesReference) ]);
            if (!result.success)
            {
                response.success = false;
                this.sendResponse(response);
                return;
            }

            const variables = Object.values(result.body) as QmlVariable[];

            response.body =
            {
                variables: []
            };

            if (variables.length === 0 || variables[0].properties === undefined)
            {
                this.sendResponse(response);
                return;
            }

            let variableCount = 0;
            const properties = variables[0].properties ?? [];

            response.body.variables = properties
                .filter(
                    (value, index, array) : boolean =>
                    {
                        if (this.filterFunctions && value.type === "function")
                            return false;

                        if (args.start !== undefined)
                        {
                            if (index < args.start)
                                return false;
                        }

                        if (args.count !== undefined)
                        {
                            if (variableCount >= args.count)
                                return false;

                            variableCount++;
                        }

                        return true;
                    }
                )
                .map<Variable>(
                    (qmlVariable, index, array) =>
                    {
                        const dapVariable : DebugProtocol.Variable =
                        {
                            name: qmlVariable.name!,
                            type: qmlVariable.type,
                            value: "" + qmlVariable.value,
                            variablesReference: 0,
                            namedVariables: 0,
                            indexedVariables: 0,
                            presentationHint:
                            {
                                kind: "property"
                            }
                        };

                        if (qmlVariable.type === "object")
                        {
                            if (qmlVariable.value !== null)

                                dapVariable.value = "object";
                            else
                                dapVariable.value = "null";

                            dapVariable.namedVariables = qmlVariable.value;
                            if (dapVariable.namedVariables !== 0)
                                dapVariable.variablesReference = this.mapHandleFrom(qmlVariable.ref!);
                        }
                        else if (qmlVariable.type === "function")
                        {
                            dapVariable.value = "function";
                            dapVariable.presentationHint!.kind = "method";
                        }
                        else if (qmlVariable.type === "undefined")
                        {
                            dapVariable.value = "undefined";
                        }
                        else if (qmlVariable.type === "string")
                        {
                            dapVariable.value = "\"" + qmlVariable.value + "\"";
                        }

                        Log.debug(() => { return "DAP Variable: " + JSON.stringify(dapVariable); });

                        return dapVariable;
                    }
                );

            if (this.sortMembers)
            {
                response.body.variables = response.body.variables
                    .sort(
                        (a, b) =>
                        {
                            if (a.name === b.name)
                                return 0;
                            else if (a.name > b.name)
                                return 1;
                            else
                                return -1;
                        }
                    );
            }

            this.sendResponse(response);
        }
        catch (error)
        {
            this.failRequest(response, 1005, "Request failed. Request: \"variables\". " + error);
        }
    }

    protected async evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments, request?: DebugProtocol.Request): Promise<void>
    {
        Log.trace("QmlDebugSession.evaluateRequest", [ response, args, request ]);

        try
        {
            const frameId = args.frameId ?? 0;
            const result = await this.v8debugger.requestEvaluate(frameId, args.expression);
            if (!result.success)
            {
                response.success = false;
                this.sendResponse(response);
                return;
            }

            response.body =
            {
                result: "" + result.body.value,
                type: result.body.type,
                variablesReference: 0,
                namedVariables: 0,
                indexedVariables: 0,
                presentationHint:
                {
                    kind: "property"
                }
            };

            if (result.body.type === "object")
            {
                if (result.body.value !== null)
                    response.body.result = "object";
                else
                    response.body.result = "null";

                response.body.variablesReference = this.mapHandleFrom(result.body.handle);
                response.body.namedVariables = result.body.value;
            }
            else if (result.body.type === "string")
            {
                response.body.result = "\"" + result.body.value + "\"";
            }
            else if (result.body.type === "function")
            {
                response.body.result = "function";
                response.body.presentationHint!.kind = "method";
            }
            else if (result.body.type === "undefined")
            {
                response.body.result = "undefined";
            }

            this.sendResponse(response);
        }
        catch (error)
        {
            this.failRequest(response, 1005, "Request failed. Request: \"evaluate\". " + error);
        }
    }

    protected async pauseRequest(response: DebugProtocol.PauseResponse, args: DebugProtocol.PauseArguments, request?: DebugProtocol.Request) : Promise<void>
    {
        Log.trace("QmlDebugSession.pauseRequest", [ response, args, request ]);

        try
        {
            const result = await this.v8debugger.requestPause();
            if (!result.success)
            {
                response.success = false;
                this.sendResponse(response);
                return;
            }

            this.breaked = true;
            this.sendResponse(response);
            this.sendEvent(new StoppedEvent("pause", this.mainQmlThreadId));
        }
        catch (error)
        {
            this.failRequest(response, 1005, "Request failed. Request: \"pause\". " + error);
        }
    }

    protected async stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments, request?: DebugProtocol.Request) : Promise<void>
    {
        Log.trace("QmlDebugSession.stepInRequest", [ response, args, request ]);

        try
        {
            const result = await this.v8debugger.requestContinue("in", 1);
            if (!result.success)
            {
                response.success = false;
                this.sendResponse(response);
                return;
            }

            this.breaked = false;

            this.sendResponse(response);
        }
        catch (error)
        {
            this.failRequest(response, 1005, "Request failed. Request: \"stepin\". " + error);
        }
    }

    protected async stepOutRequest(response: DebugProtocol.StepOutResponse, args: DebugProtocol.StepOutArguments, request?: DebugProtocol.Request) : Promise<void>
    {
        Log.trace("QmlDebugSession.stepOutRequest", [ response, args, request ]);

        try
        {
            const result = await this.v8debugger.requestContinue("out", 1);
            if (!result.success)
            {
                response.success = false;
                this.sendResponse(response);
                return;
            }

            this.breaked = false;

            this.sendResponse(response);
        }
        catch (error)
        {
            this.failRequest(response, 1005, "Request failed. Request: \"stepout\". " + error);
        }
    }

    protected async nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments, request?: DebugProtocol.Request) : Promise<void>
    {
        Log.trace("QmlDebugSession.nextRequest", [ response, args, request ]);

        try
        {
            const result = await this.v8debugger.requestContinue("next", 1);
            if (!result.success)
            {
                response.success = false;
                this.sendResponse(response);
                return;
            }

            this.breaked = false;

            this.sendResponse(response);
        }
        catch (error)
        {
            this.failRequest(response, 1005, "Request failed. Request: \"next\". " + error);
        }
    }

    protected async continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments, request?: DebugProtocol.Request) : Promise<void>
    {
        Log.trace("QmlDebugSession.continueRequest", [ response, args, request ]);

        try
        {
            const result = await this.v8debugger.requestContinue(undefined, undefined);
            if (!result.success)
            {
                response.success = false;
                this.sendResponse(response);
                return;
            }

            this.breaked = false;

            this.sendResponse(response);
        }
        catch (error)
        {
            this.failRequest(response, 1005, "Request failed. Request: \"continue\". " + error);
        }
    }

    protected customRequest(command : string, response : DebugProtocol.Response, args : any, request?: DebugProtocol.Request) : void
    {
        void this.handleCustomRequest(command, response, args).catch((error) : void =>
        {
            this.sendErrorResponse(response,
                {
                    id: 1008,
                    format: "QML Debug: Custom request '" + command + "' failed. " + error,
                    showUser: true
                }
            );
        });
    }

    /** Create a DAP session, optionally using mocked Qt services for unit tests. */
    public constructor(session : vscode.DebugSession, dependencies : QmlDebugSessionDependencies = {})
    {
        super();

        this.packetManager_ = dependencies.packetManager ?? new PacketManager(this);
        this.qmlDebugger = dependencies.qmlDebugger ?? new ServiceQmlDebugger(this);
        this.debugMessages = dependencies.debugMessages ?? new ServiceDebugMessages(this);
        this.v8debugger = dependencies.v8debugger ?? new ServiceNativeDebugger(this);
        this.declarativeDebugClient = dependencies.declarativeDebugClient ?? new ServiceDeclarativeDebugClient(this);
        this.inspector = dependencies.inspector ?? new ServiceQmlInspector(this);
        this.profiler = dependencies.profiler ?? new ServiceQmlProfiler(this);
        this.processLauncher = dependencies.processLauncher ?? ((options : LaunchProcessOptions) : ChildProcess =>
        {
            return spawn(options.program, options.args,
                {
                    cwd: options.cwd,
                    env: options.env,
                    stdio: "ignore"
                }
            );
        });

        this.filterFunctions = vscode.workspace.getConfiguration("qml-debug").get<boolean>("filterFunctions", true);
        this.sortMembers = vscode.workspace.getConfiguration("qml-debug").get<boolean>("sortMembers", true);
        vscode.workspace.onDidChangeConfiguration(() =>
        {
            const filterFunctions = vscode.workspace.getConfiguration("qml-debug").get<boolean>("filterFunctions", true);
            const sortMembers = vscode.workspace.getConfiguration("qml-debug").get<boolean>("sortMembers", true);
            const invalidate = (this.filterFunctions !== filterFunctions || this.sortMembers !== sortMembers);

            this.filterFunctions = filterFunctions;
            this.sortMembers = sortMembers;

            if (invalidate && this.breaked)
                this.sendEvent(new InvalidatedEvent());
        });

        Log.trace("QmlDebugSession.continueRequest", [ session ]);
    }
}

/** VS Code factory that creates an inline QML debug adapter session. */
export class QmlDebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory
{
    /** Create the debug adapter descriptor consumed by VS Code's debug service. */
    public createDebugAdapterDescriptor(session: vscode.DebugSession, executable: vscode.DebugAdapterExecutable | undefined): vscode.ProviderResult<vscode.DebugAdapterDescriptor>
    {
        Log.trace("QmlDebugAdapterFactory.createDebugAdapterDescriptor", [ session, executable ]);

        return new vscode.DebugAdapterInlineImplementation(new QmlDebugSession(session));
    }

}
