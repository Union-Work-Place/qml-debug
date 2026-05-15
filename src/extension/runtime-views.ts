import { DEFAULT_PROFILER_FEATURE_MASK } from "@qml-debug/protocol/profiler-features";
import * as vscode from "vscode";


/** Snapshot of the lightweight inspector state used by the Debug view. */
interface InspectorStatusResponse
{
    /** Whether the active runtime negotiated the QmlInspector service. */
    available : boolean;
    /** Whether the Qt inspect tool is currently enabled. */
    enabled : boolean;
    /** Whether the target application is forced above other windows. */
    showAppOnTop : boolean;
    /** Currently selected runtime object ids. */
    currentObjectIds : number[];
    /** Number of in-flight inspector requests. */
    pendingRequestCount : number;
}

/** Decoded inspector metadata for the current selection. */
interface InspectorObjectTreeResponse
{
    /** Object ids that were requested for tree expansion. */
    selectedObjectIds : number[];
    /** Materialized runtime objects for the selected ids. */
    objects : {
        debugId : number;
        className : string;
        idString : string;
        name : string;
        propertyCount : number;
    }[];
    /** Context-to-object mapping for the selected subtree. */
    contexts : { debugId : number; objectIds : number[] }[];
}

/** Snapshot of profiler capture state used by the Debug view. */
interface ProfilerStatusResponse
{
    /** Whether the active runtime negotiated the profiler service. */
    available : boolean;
    /** Whether the runtime also exposes EngineControl coordination hooks. */
    engineControlAvailable : boolean;
    /** Human-readable profiler backend description. */
    backend : string;
    /** Whether capture is currently active. */
    recording : boolean;
    /** Requested Qt feature mask in decimal form. */
    requestedFeatureMask : string;
    /** Human-readable profiler feature names. */
    requestedFeatures : string[];
    /** Requested packet flush interval in milliseconds. */
    flushInterval : number;
    /** Number of packets captured so far. */
    packetCount : number;
    /** Total number of payload bytes captured so far. */
    receivedBytes : number;
    /** Timestamp of the most recent packet, if any. */
    lastPacketTimestamp? : string;
    /** Recent packet summaries for lightweight inspection. */
    recentPackets : { timestamp : string; size : number; kind : string; hexPreview : string }[];
    /** Structured timeline events decoded from captured packets. */
    timelineEvents : { timestamp : string; size : number; kind : string; category : string; label : string; valueUnit? : string; hexPreview : string; decodedValue? : boolean | number | string | number[] }[];
}

/** Export payload opened by the profiler JSON command. */
interface ProfilerExportResponse
{
    /** Summary view of the current capture state. */
    summary : ProfilerStatusResponse;
    /** Frequency table grouped by timeline event kind. */
    eventKinds : { kind : string; count : number }[];
    /** Frequency table grouped by semantic timeline category. */
    eventCategories : { category : string; count : number }[];
    /** Full structured event list for the current capture buffer. */
    timeline : { timestamp : string; size : number; kind : string; category : string; label : string; valueUnit? : string; hexPreview : string; decodedValue? : boolean | number | string | number[] }[];
}

/** Mutable runtime snapshot mirrored into the tree views. */
interface RuntimeViewSnapshot
{
    /** Preferred QML debug session used for runtime requests. */
    session? : vscode.DebugSession;
    /** Last known inspector status for the preferred session. */
    inspectorStatus? : InspectorStatusResponse;
    /** Last known inspector object tree for the current selection. */
    inspectorObjectTree? : InspectorObjectTreeResponse;
    /** Last known profiler status for the preferred session. */
    profilerStatus? : ProfilerStatusResponse;
}

/** Leaf tree item used by the inspector and profiler runtime views. */
class RuntimeTreeItem extends vscode.TreeItem
{
    /** Create a single-line runtime item with an optional command. */
    public constructor(label : string, description? : string, command? : vscode.Command)
    {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.description = description;
        this.command = command;
    }
}

/** Session-aware tracker used by runtime views when multiple QML sessions exist. */
export class QmlRuntimeSessionTracker
{
    /** Known live QML sessions keyed by debug-session id. */
    private readonly sessions = new Map<string, vscode.DebugSession>();
    /** QML session ids in most-recently-relevant order. */
    private sessionOrder : string[] = [];
    /** Last focused QML session id, if any. */
    private focusedSessionId? : string;

    /** Register a started QML debug session. */
    public onSessionStarted(session : vscode.DebugSession) : void
    {
        if (session.type !== "qml")
            return;

        this.sessions.set(session.id, session);
        this.promoteSession(session.id);
        if (this.focusedSessionId === undefined)
            this.focusedSessionId = session.id;
    }

    /** Register the newly focused session, if it is a QML debug session. */
    public onActiveSessionChanged(session : vscode.DebugSession | undefined) : void
    {
        if (session?.type !== "qml")
            return;

        this.sessions.set(session.id, session);
        this.promoteSession(session.id);
        this.focusedSessionId = session.id;
    }

    /** Remove a terminated QML session and select the next fallback candidate. */
    public onSessionTerminated(session : vscode.DebugSession) : void
    {
        if (!this.sessions.has(session.id))
            return;

        this.sessions.delete(session.id);
        this.sessionOrder = this.sessionOrder.filter((value) : boolean => { return value !== session.id; });

        if (this.focusedSessionId === session.id)
            this.focusedSessionId = this.sessionOrder.length > 0 ? this.sessionOrder[0] : undefined;
    }

    /** Return the preferred active QML session using focus first and live-session fallback second. */
    public getPreferredSession(activeSession : vscode.DebugSession | undefined) : vscode.DebugSession | undefined
    {
        if (activeSession?.type === "qml")
        {
            this.onActiveSessionChanged(activeSession);
            return activeSession;
        }

        if (this.focusedSessionId !== undefined)
        {
            const focusedSession = this.sessions.get(this.focusedSessionId);
            if (focusedSession !== undefined)
                return focusedSession;
        }

        const fallbackSessionId = this.sessionOrder[0];
        return fallbackSessionId === undefined ? undefined : this.sessions.get(fallbackSessionId);
    }

    /** Move one session id to the front of the fallback order. */
    private promoteSession(sessionId : string) : void
    {
        this.sessionOrder = this.sessionOrder.filter((value) : boolean => { return value !== sessionId; });
        this.sessionOrder.unshift(sessionId);
    }
}

/** Return true when runtime views still need a polling fallback for live state changes. */
export function shouldPollRuntimeViews(inspectorStatus : InspectorStatusResponse | undefined, profilerStatus : ProfilerStatusResponse | undefined) : boolean
{
    return (inspectorStatus?.enabled ?? false)
        || ((inspectorStatus?.pendingRequestCount ?? 0) > 0)
        || (profilerStatus?.recording ?? false);
}

/** Derive the profiler toolbar context values from the last known runtime status. */
export function getProfilerActionContext(profilerStatus : ProfilerStatusResponse | undefined) : { available : boolean; recording : boolean }
{
    return {
        available: profilerStatus?.available ?? false,
        recording: (profilerStatus?.available ?? false) && (profilerStatus?.recording ?? false)
    };
}

/** Execute a QML runtime request against one concrete session and suppress passive refresh failures. */
async function requestQmlRuntime<T>(session : vscode.DebugSession | undefined, command : string, args? : any) : Promise<T | undefined>
{
    if (session === undefined)
        return undefined;

    try
    {
        return await session.customRequest(command, args) as T;
    }
    catch (_error)
    {
        return undefined;
    }
}

/** Execute a QML runtime request against one concrete session and surface failures to command handlers. */
async function requireQmlRuntime<T>(session : vscode.DebugSession | undefined, command : string, args? : any) : Promise<T>
{
    if (session === undefined)
        throw new Error("No active QML debug session.");

    return session.customRequest(command, args) as Promise<T>;
}

/** Run a command handler and surface failures as VS Code warnings. */
async function withRuntimeErrors<T>(work : () => Promise<T>) : Promise<T | undefined>
{
    try
    {
        return await work();
    }
    catch (error)
    {
        await vscode.window.showWarningMessage(String(error));
        return undefined;
    }
}

/** Inspector tree provider that mirrors the current runtime selection into the Debug view. */
class InspectorViewProvider implements vscode.TreeDataProvider<RuntimeTreeItem>
{
    /** Tree change emitter consumed by VS Code. */
    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<RuntimeTreeItem | undefined | void>();
    /** Event raised when the inspector tree should be refreshed. */
    public readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

    /** Notify VS Code that the inspector tree data changed. */
    public refresh() : void
    {
        this.onDidChangeTreeDataEmitter.fire();
    }

    /** Return the already-constructed tree item. */
    public getTreeItem(element : RuntimeTreeItem) : vscode.TreeItem
    {
        return element;
    }

    /** Materialize the top-level inspector summary nodes. */
    public async getChildren(element? : RuntimeTreeItem) : Promise<RuntimeTreeItem[]>
    {
        return element === undefined ? [] : [];
    }
}

/** Profiler tree provider that mirrors capture state into the Debug view. */
class ProfilerViewProvider implements vscode.TreeDataProvider<RuntimeTreeItem>
{
    /** Tree change emitter consumed by VS Code. */
    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<RuntimeTreeItem | undefined | void>();
    /** Event raised when the profiler tree should be refreshed. */
    public readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

    /** Notify VS Code that the profiler tree data changed. */
    public refresh() : void
    {
        this.onDidChangeTreeDataEmitter.fire();
    }

    /** Return the already-constructed tree item. */
    public getTreeItem(element : RuntimeTreeItem) : vscode.TreeItem
    {
        return element;
    }

    /** Materialize the top-level profiler summary nodes. */
    public async getChildren(element? : RuntimeTreeItem) : Promise<RuntimeTreeItem[]>
    {
        return element === undefined ? [] : [];
    }
}

/** Register runtime tree views and commands that talk to the active QML debug session. */
export function registerRuntimeViews(context : vscode.ExtensionContext) : void
{
    const inspectorProvider = new InspectorViewProvider();
    const profilerProvider = new ProfilerViewProvider();
    const sessionTracker = new QmlRuntimeSessionTracker();
    const snapshot : RuntimeViewSnapshot = {};
    let refreshTimer : NodeJS.Timeout | undefined;
    let refreshInFlight : Promise<void> | undefined;
    const updatePolling = () : void =>
    {
        const shouldPoll = snapshot.session !== undefined && shouldPollRuntimeViews(snapshot.inspectorStatus, snapshot.profilerStatus);
        if (!shouldPoll)
        {
            if (refreshTimer !== undefined)
            {
                clearInterval(refreshTimer);
                refreshTimer = undefined;
            }
            return;
        }

        if (refreshTimer !== undefined)
            return;

        refreshTimer = setInterval(() : void =>
        {
            void refreshAllViews();
        }, 1000);
    };
    const refreshProviders = () : void =>
    {
        inspectorProvider.refresh();
        profilerProvider.refresh();
    };
    const updateCommandContexts = async () : Promise<void> =>
    {
        const profilerContext = getProfilerActionContext(snapshot.profilerStatus);
        await vscode.commands.executeCommand("setContext", "qmldebug.profilerAvailable", profilerContext.available);
        await vscode.commands.executeCommand("setContext", "qmldebug.profilerRecording", profilerContext.recording);
    };
    const refreshAllViews = async () : Promise<void> =>
    {
        if (refreshInFlight !== undefined)
            return refreshInFlight;

        refreshInFlight = (async () : Promise<void> =>
        {
            snapshot.session = sessionTracker.getPreferredSession(vscode.debug.activeDebugSession);

            if (snapshot.session === undefined)
            {
                snapshot.inspectorStatus = undefined;
                snapshot.inspectorObjectTree = undefined;
                snapshot.profilerStatus = undefined;
                await updateCommandContexts();
                updatePolling();
                refreshProviders();
                return;
            }

            snapshot.inspectorStatus = await requestQmlRuntime<InspectorStatusResponse>(snapshot.session, "qml/inspector/status");
            snapshot.profilerStatus = await requestQmlRuntime<ProfilerStatusResponse>(snapshot.session, "qml/profiler/status");

            snapshot.inspectorObjectTree = snapshot.inspectorStatus?.available && snapshot.inspectorStatus.currentObjectIds.length > 0
                ? await requestQmlRuntime<InspectorObjectTreeResponse>(snapshot.session, "qml/inspector/objectTree", { objectIds: snapshot.inspectorStatus.currentObjectIds })
                : undefined;

            await updateCommandContexts();
            updatePolling();
            refreshProviders();
        })().finally(() : void =>
        {
            refreshInFlight = undefined;
        });

        return refreshInFlight;
    };

    inspectorProvider.getChildren = async (element? : RuntimeTreeItem) : Promise<RuntimeTreeItem[]> =>
    {
        if (element !== undefined)
            return [];

        if (snapshot.session === undefined)
            return [ new RuntimeTreeItem("No active QML session") ];

        const status = snapshot.inspectorStatus;
        if (status === undefined)
            return [ new RuntimeTreeItem("Inspector data unavailable") ];

        const selectedObject = snapshot.inspectorObjectTree?.objects[0];
        return [
            new RuntimeTreeItem("Inspector service", status.available ? "available" : "unavailable"),
            new RuntimeTreeItem("Interactive selection", status.enabled ? "enabled" : "disabled",
                { command: "qml-debug.toggleInspector", title: "Toggle Inspector" }),
            new RuntimeTreeItem("Show app on top", status.showAppOnTop ? "on" : "off",
                { command: "qml-debug.toggleInspectorAppOnTop", title: "Toggle App On Top" }),
            new RuntimeTreeItem("Selected object ids", status.currentObjectIds.length > 0 ? status.currentObjectIds.join(", ") : "none",
                { command: "qml-debug.inspectCurrentQmlItem", title: "Inspect Current QML Item" }),
            new RuntimeTreeItem("Selected object", selectedObject === undefined ? "none" : selectedObject.className + " #" + selectedObject.debugId),
            new RuntimeTreeItem("Selected object id", selectedObject?.idString || selectedObject?.name || "none"),
            new RuntimeTreeItem("Selected object properties", selectedObject === undefined ? "0" : String(selectedObject.propertyCount)),
            new RuntimeTreeItem("Contexts in selection", snapshot.inspectorObjectTree === undefined ? "0" : String(snapshot.inspectorObjectTree.contexts.length)),
            new RuntimeTreeItem("Pending requests", String(status.pendingRequestCount))
        ];
    };

    profilerProvider.getChildren = async (element? : RuntimeTreeItem) : Promise<RuntimeTreeItem[]> =>
    {
        if (element !== undefined)
            return [];

        if (snapshot.session === undefined)
            return [ new RuntimeTreeItem("No active QML session") ];

        const status = snapshot.profilerStatus;
        if (status === undefined)
            return [ new RuntimeTreeItem("Profiler data unavailable") ];

        return [
            new RuntimeTreeItem("Profiler service", status.available ? "available" : "unavailable"),
            new RuntimeTreeItem("Profiler backend", status.backend),
            new RuntimeTreeItem("EngineControl", status.engineControlAvailable ? "available" : "unavailable"),
            new RuntimeTreeItem("Recording", status.recording ? "running" : "stopped",
                { command: status.recording ? "qml-debug.stopProfiler" : "qml-debug.startProfiler", title: "Toggle Profiler" }),
            new RuntimeTreeItem("Requested features", status.requestedFeatures.length > 0 ? status.requestedFeatures.join(", ") : "none"),
            new RuntimeTreeItem("Flush interval", status.flushInterval + " ms"),
            new RuntimeTreeItem("Packets received", String(status.packetCount)),
            new RuntimeTreeItem("Bytes received", String(status.receivedBytes)),
            new RuntimeTreeItem("Timeline events", String(status.timelineEvents.length)),
            new RuntimeTreeItem("Last event kind", status.timelineEvents.length > 0 ? status.timelineEvents[status.timelineEvents.length - 1].kind : "none"),
            new RuntimeTreeItem("Last event category", status.timelineEvents.length > 0 ? status.timelineEvents[status.timelineEvents.length - 1].category : "none"),
            new RuntimeTreeItem("Last packet", status.lastPacketTimestamp ?? "none"),
            new RuntimeTreeItem("Export snapshot", "open JSON",
                { command: "qml-debug.exportProfilerSnapshot", title: "Export Profiler Snapshot" })
        ];
    };

    context.subscriptions.push(
        vscode.window.registerTreeDataProvider("qml-debug.inspector", inspectorProvider),
        vscode.window.registerTreeDataProvider("qml-debug.profiler", profilerProvider),
        vscode.commands.registerCommand("qml-debug.refreshRuntimeTools", () : Thenable<void> => refreshAllViews()),
        vscode.commands.registerCommand("qml-debug.inspectCurrentQmlItem", async () : Promise<void> =>
        {
            await withRuntimeErrors(async () : Promise<void> =>
            {
                const session = sessionTracker.getPreferredSession(vscode.debug.activeDebugSession);
                const editor = vscode.window.activeTextEditor;
                if (editor === undefined)
                    throw new Error("Open a QML source file before selecting an item in the inspector.");

                const document = editor.document;
                if (document.uri.scheme !== "file")
                    throw new Error("The inspector source lookup only supports filesystem-backed QML documents.");

                await requireQmlRuntime(session, "qml/inspector/selectBySource",
                    {
                        path: document.fileName,
                        line: editor.selection.active.line + 1,
                        column: editor.selection.active.character + 1
                    }
                );
                await refreshAllViews();
            });
        }),
        vscode.commands.registerCommand("qml-debug.toggleInspector", async () : Promise<void> =>
        {
            await withRuntimeErrors(async () : Promise<void> =>
            {
                const session = sessionTracker.getPreferredSession(vscode.debug.activeDebugSession);
                const status = await requireQmlRuntime<InspectorStatusResponse>(session, "qml/inspector/status");
                await requireQmlRuntime(session, "qml/inspector/setEnabled", { enabled: !status.enabled });
                await refreshAllViews();
            });
        }),
        vscode.commands.registerCommand("qml-debug.toggleInspectorAppOnTop", async () : Promise<void> =>
        {
            await withRuntimeErrors(async () : Promise<void> =>
            {
                const session = sessionTracker.getPreferredSession(vscode.debug.activeDebugSession);
                const status = await requireQmlRuntime<InspectorStatusResponse>(session, "qml/inspector/status");
                await requireQmlRuntime(session, "qml/inspector/setShowAppOnTop", { showAppOnTop: !status.showAppOnTop });
                await refreshAllViews();
            });
        }),
        vscode.commands.registerCommand("qml-debug.startProfiler", async () : Promise<void> =>
        {
            await withRuntimeErrors(async () : Promise<void> =>
            {
                const session = sessionTracker.getPreferredSession(vscode.debug.activeDebugSession);
                await requireQmlRuntime(session, "qml/profiler/start",
                    {
                        featureMask: DEFAULT_PROFILER_FEATURE_MASK.toString(),
                        flushInterval: 250
                    }
                );
                await refreshAllViews();
            });
        }),
        vscode.commands.registerCommand("qml-debug.stopProfiler", async () : Promise<void> =>
        {
            await withRuntimeErrors(async () : Promise<void> =>
            {
                const session = sessionTracker.getPreferredSession(vscode.debug.activeDebugSession);
                await requireQmlRuntime(session, "qml/profiler/stop");
                await refreshAllViews();
            });
        }),
        vscode.commands.registerCommand("qml-debug.clearProfiler", async () : Promise<void> =>
        {
            await withRuntimeErrors(async () : Promise<void> =>
            {
                const session = sessionTracker.getPreferredSession(vscode.debug.activeDebugSession);
                await requireQmlRuntime(session, "qml/profiler/clear");
                await refreshAllViews();
            });
        }),
        vscode.commands.registerCommand("qml-debug.exportProfilerSnapshot", async () : Promise<void> =>
        {
            await withRuntimeErrors(async () : Promise<void> =>
            {
                const session = sessionTracker.getPreferredSession(vscode.debug.activeDebugSession);
                const status = await requireQmlRuntime<ProfilerExportResponse>(session, "qml/profiler/export");
                const document = await vscode.workspace.openTextDocument(
                    {
                        language: "json",
                        content: JSON.stringify(status, null, 2)
                    }
                );
                await vscode.window.showTextDocument(document, { preview: true });
            });
        }),
        vscode.debug.onDidStartDebugSession((session : vscode.DebugSession) : void =>
        {
            sessionTracker.onSessionStarted(session);
            void refreshAllViews();
        }),
        vscode.debug.onDidTerminateDebugSession((session : vscode.DebugSession) : void =>
        {
            sessionTracker.onSessionTerminated(session);
            void refreshAllViews();
        }),
        vscode.debug.onDidChangeActiveDebugSession((session : vscode.DebugSession | undefined) : void =>
        {
            sessionTracker.onActiveSessionChanged(session);
            void refreshAllViews();
        }),
        new vscode.Disposable(() : void =>
        {
            if (refreshTimer !== undefined)
                clearInterval(refreshTimer);
        })
    );

    void refreshAllViews();
}