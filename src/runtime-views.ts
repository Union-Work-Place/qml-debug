import { DEFAULT_PROFILER_FEATURE_MASK } from "@qml-debug/profiler-features";
import * as vscode from "vscode";


interface InspectorStatusResponse
{
    available : boolean;
    enabled : boolean;
    showAppOnTop : boolean;
    currentObjectIds : number[];
    pendingRequestCount : number;
}

interface InspectorObjectTreeResponse
{
    selectedObjectIds : number[];
    objects : {
        debugId : number;
        className : string;
        idString : string;
        name : string;
        propertyCount : number;
    }[];
    contexts : { debugId : number; objectIds : number[] }[];
}

interface ProfilerStatusResponse
{
    available : boolean;
    recording : boolean;
    requestedFeatureMask : string;
    requestedFeatures : string[];
    flushInterval : number;
    packetCount : number;
    receivedBytes : number;
    lastPacketTimestamp? : string;
    recentPackets : { timestamp : string; size : number; kind : string; hexPreview : string }[];
    timelineEvents : { timestamp : string; size : number; kind : string; hexPreview : string; decodedValue? : boolean | number | string | number[] }[];
}

interface ProfilerExportResponse
{
    summary : ProfilerStatusResponse;
    eventKinds : { kind : string; count : number }[];
    timeline : { timestamp : string; size : number; kind : string; hexPreview : string; decodedValue? : boolean | number | string | number[] }[];
}

class RuntimeTreeItem extends vscode.TreeItem
{
    public constructor(label : string, description? : string, command? : vscode.Command)
    {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.description = description;
        this.command = command;
    }
}

let trackedQmlSession : vscode.DebugSession | undefined;

async function getActiveQmlSession() : Promise<vscode.DebugSession | undefined>
{
    const active = vscode.debug.activeDebugSession;
    if (active?.type === "qml")
        return active;

    return trackedQmlSession;
}

async function requestQmlRuntime<T>(command : string, args? : any) : Promise<T | undefined>
{
    const session = await getActiveQmlSession();
    if (session === undefined)
        return undefined;

    return session.customRequest(command, args) as Promise<T>;
}

async function requireQmlRuntime<T>(command : string, args? : any) : Promise<T>
{
    const session = await getActiveQmlSession();
    if (session === undefined)
        throw new Error("No active QML debug session.");

    return session.customRequest(command, args) as Promise<T>;
}

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

class InspectorViewProvider implements vscode.TreeDataProvider<RuntimeTreeItem>
{
    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<RuntimeTreeItem | undefined | void>();
    public readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

    public refresh() : void
    {
        this.onDidChangeTreeDataEmitter.fire();
    }

    public getTreeItem(element : RuntimeTreeItem) : vscode.TreeItem
    {
        return element;
    }

    public async getChildren(element? : RuntimeTreeItem) : Promise<RuntimeTreeItem[]>
    {
        if (element !== undefined)
            return [];

        const status = await requestQmlRuntime<InspectorStatusResponse>("qml/inspector/status");
        if (status === undefined)
            return [ new RuntimeTreeItem("No active QML session") ];

        const objectTree = status.currentObjectIds.length > 0
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
}

class ProfilerViewProvider implements vscode.TreeDataProvider<RuntimeTreeItem>
{
    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<RuntimeTreeItem | undefined | void>();
    public readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

    public refresh() : void
    {
        this.onDidChangeTreeDataEmitter.fire();
    }

    public getTreeItem(element : RuntimeTreeItem) : vscode.TreeItem
    {
        return element;
    }

    public async getChildren(element? : RuntimeTreeItem) : Promise<RuntimeTreeItem[]>
    {
        if (element !== undefined)
            return [];

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
}

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