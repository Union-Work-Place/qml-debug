import { DEFAULT_PROFILER_FEATURE_MASK } from "@qml-debug/profiler-features";
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
    timelineEvents : { timestamp : string; size : number; kind : string; hexPreview : string; decodedValue? : boolean | number | string | number[] }[];
}

/** Export payload opened by the profiler JSON command. */
interface ProfilerExportResponse
{
    /** Summary view of the current capture state. */
    summary : ProfilerStatusResponse;
    /** Frequency table grouped by timeline event kind. */
    eventKinds : { kind : string; count : number }[];
    /** Full structured event list for the current capture buffer. */
    timeline : { timestamp : string; size : number; kind : string; hexPreview : string; decodedValue? : boolean | number | string | number[] }[];
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

/** Most recent QML debug session seen by the extension when no active session is focused. */
let trackedQmlSession : vscode.DebugSession | undefined;

/** Return the active QML debug session, falling back to the last tracked one when needed. */
async function getActiveQmlSession() : Promise<vscode.DebugSession | undefined>
{
    const active = vscode.debug.activeDebugSession;
    if (active?.type === "qml")
        return active;

    return trackedQmlSession;
}

/** Execute a QML runtime request and suppress request failures for passive UI polling. */
async function requestQmlRuntime<T>(command : string, args? : any) : Promise<T | undefined>
{
    const session = await getActiveQmlSession();
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

/** Execute a QML runtime request and surface failures to command handlers. */
async function requireQmlRuntime<T>(command : string, args? : any) : Promise<T>
{
    const session = await getActiveQmlSession();
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
        if (element !== undefined)
            return [];

        try
        {
            const status = await requestQmlRuntime<InspectorStatusResponse>("qml/inspector/status");
            if (status === undefined)
                return [ new RuntimeTreeItem("No active QML session") ];

            const objectTree = status.available && status.currentObjectIds.length > 0
                ? await requestQmlRuntime<InspectorObjectTreeResponse>("qml/inspector/objectTree", { objectIds: status.currentObjectIds })
                : undefined;
            const selectedObject = objectTree?.objects[0];

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
                new RuntimeTreeItem("Contexts in selection", objectTree === undefined ? "0" : String(objectTree.contexts.length)),
                new RuntimeTreeItem("Pending requests", String(status.pendingRequestCount))
            ];
        }
        catch (error)
        {
            return [ new RuntimeTreeItem("Inspector data unavailable", String(error)) ];
        }
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
        if (element !== undefined)
            return [];

        try
        {
            const status = await requestQmlRuntime<ProfilerStatusResponse>("qml/profiler/status");
            if (status === undefined)
                return [ new RuntimeTreeItem("No active QML session") ];

            return [
                new RuntimeTreeItem("Profiler service", status.available ? "available" : "unavailable"),
                new RuntimeTreeItem("Recording", status.recording ? "running" : "stopped",
                    { command: status.recording ? "qml-debug.stopProfiler" : "qml-debug.startProfiler", title: "Toggle Profiler" }),
                new RuntimeTreeItem("Requested features", status.requestedFeatures.length > 0 ? status.requestedFeatures.join(", ") : "none"),
                new RuntimeTreeItem("Flush interval", status.flushInterval + " ms"),
                new RuntimeTreeItem("Packets received", String(status.packetCount)),
                new RuntimeTreeItem("Bytes received", String(status.receivedBytes)),
                new RuntimeTreeItem("Timeline events", String(status.timelineEvents.length)),
                new RuntimeTreeItem("Last event kind", status.timelineEvents.length > 0 ? status.timelineEvents[status.timelineEvents.length - 1].kind : "none"),
                new RuntimeTreeItem("Last packet", status.lastPacketTimestamp ?? "none"),
                new RuntimeTreeItem("Export snapshot", "open JSON",
                    { command: "qml-debug.exportProfilerSnapshot", title: "Export Profiler Snapshot" })
            ];
        }
        catch (error)
        {
            return [ new RuntimeTreeItem("Profiler data unavailable", String(error)) ];
        }
    }
}

/** Register runtime tree views and commands that talk to the active QML debug session. */
export function registerRuntimeViews(context : vscode.ExtensionContext) : void
{
    const inspectorProvider = new InspectorViewProvider();
    const profilerProvider = new ProfilerViewProvider();
    const refreshAllViews = () : void =>
    {
        inspectorProvider.refresh();
        profilerProvider.refresh();
    };

    context.subscriptions.push(
        vscode.window.registerTreeDataProvider("qml-debug.inspector", inspectorProvider),
        vscode.window.registerTreeDataProvider("qml-debug.profiler", profilerProvider),
        vscode.commands.registerCommand("qml-debug.refreshRuntimeTools", refreshAllViews),
        vscode.commands.registerCommand("qml-debug.inspectCurrentQmlItem", async () : Promise<void> =>
        {
            await withRuntimeErrors(async () : Promise<void> =>
            {
                const editor = vscode.window.activeTextEditor;
                if (editor === undefined)
                    throw new Error("Open a QML source file before selecting an item in the inspector.");

                const document = editor.document;
                if (document.uri.scheme !== "file")
                    throw new Error("The inspector source lookup only supports filesystem-backed QML documents.");

                await requireQmlRuntime("qml/inspector/selectBySource",
                    {
                        path: document.fileName,
                        line: editor.selection.active.line + 1,
                        column: editor.selection.active.character + 1
                    }
                );
                refreshAllViews();
            });
        }),
        vscode.commands.registerCommand("qml-debug.toggleInspector", async () : Promise<void> =>
        {
            await withRuntimeErrors(async () : Promise<void> =>
            {
                const status = await requireQmlRuntime<InspectorStatusResponse>("qml/inspector/status");
                await requireQmlRuntime("qml/inspector/setEnabled", { enabled: !status.enabled });
                refreshAllViews();
            });
        }),
        vscode.commands.registerCommand("qml-debug.toggleInspectorAppOnTop", async () : Promise<void> =>
        {
            await withRuntimeErrors(async () : Promise<void> =>
            {
                const status = await requireQmlRuntime<InspectorStatusResponse>("qml/inspector/status");
                await requireQmlRuntime("qml/inspector/setShowAppOnTop", { showAppOnTop: !status.showAppOnTop });
                refreshAllViews();
            });
        }),
        vscode.commands.registerCommand("qml-debug.startProfiler", async () : Promise<void> =>
        {
            await withRuntimeErrors(async () : Promise<void> =>
            {
                await requireQmlRuntime("qml/profiler/start",
                    {
                        featureMask: DEFAULT_PROFILER_FEATURE_MASK.toString(),
                        flushInterval: 250
                    }
                );
                refreshAllViews();
            });
        }),
        vscode.commands.registerCommand("qml-debug.stopProfiler", async () : Promise<void> =>
        {
            await withRuntimeErrors(async () : Promise<void> =>
            {
                await requireQmlRuntime("qml/profiler/stop");
                refreshAllViews();
            });
        }),
        vscode.commands.registerCommand("qml-debug.clearProfiler", async () : Promise<void> =>
        {
            await withRuntimeErrors(async () : Promise<void> =>
            {
                await requireQmlRuntime("qml/profiler/clear");
                refreshAllViews();
            });
        }),
        vscode.commands.registerCommand("qml-debug.exportProfilerSnapshot", async () : Promise<void> =>
        {
            await withRuntimeErrors(async () : Promise<void> =>
            {
                const status = await requireQmlRuntime<ProfilerExportResponse>("qml/profiler/export");
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
            if (session.type === "qml")
                trackedQmlSession = session;
            refreshAllViews();
        }),
        vscode.debug.onDidTerminateDebugSession((session : vscode.DebugSession) : void =>
        {
            if (trackedQmlSession?.id === session.id)
                trackedQmlSession = undefined;
            refreshAllViews();
        }),
        vscode.debug.onDidChangeActiveDebugSession((session : vscode.DebugSession | undefined) : void =>
        {
            if (session?.type === "qml")
                trackedQmlSession = session;
            refreshAllViews();
        }),
        new vscode.Disposable(() : void =>
        {
            clearInterval(refreshTimer);
        })
    );

    const refreshTimer = setInterval(() : void => { refreshAllViews(); }, 1000);
    refreshAllViews();
}