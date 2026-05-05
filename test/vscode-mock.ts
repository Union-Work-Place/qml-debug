/** Disposable returned by mocked VS Code event subscriptions. */
export class Disposable
{
    private readonly callback? : () => void;

    /** Store an optional dispose callback. */
    public constructor(callback? : () => void)
    {
        this.callback = callback;
    }

    /** Release the mocked subscription. */
    public dispose() : void
    {
        this.callback?.();
    }
}

/** Minimal EventEmitter implementation for tree views and debug events. */
export class EventEmitter<ValueType>
{
    /** Event subscription function. */
    public readonly event = () : Disposable => new Disposable();

    /** Emit a value to listeners. */
    public fire(_value? : ValueType) : void
    {
        return undefined;
    }
}

/** Minimal tree item state enum. */
export const TreeItemCollapsibleState =
{
    None: 0
};

/** Minimal tree item used by the runtime view providers. */
export class TreeItem
{
    public description? : string;
    public command? : any;

    public constructor(public readonly label : string, public readonly collapsibleState : number)
    {
    }
}

/** Minimal workspace API used by QmlDebugSession tests. */
export const workspace =
{
    /** Return configuration values used by the adapter constructor. */
    getConfiguration: () : { get<ValueType>(key : string, defaultValue : ValueType) : ValueType; update() : Promise<void> } =>
    {
        return {
            get: <ValueType>(key : string, defaultValue : ValueType) : ValueType => defaultValue,
            update: async () : Promise<void> => undefined
        };
    },

    /** Register a mocked configuration-change listener. */
    onDidChangeConfiguration: () : Disposable => new Disposable(),

    /** Open an untitled text document in tests. */
    openTextDocument: async (options : any) : Promise<any> => options
};

/** Minimal commands API used by extension activation tests and constructors. */
export const commands =
{
    /** Register a mocked command. */
    registerCommand: () : Disposable => new Disposable(),
    /** Execute a mocked command. */
    executeCommand: async () : Promise<void> => undefined
};

/** Mocked window API. */
export const window =
{
    /** Show an informational message in tests. */
    showInformationMessage: async () : Promise<void> => undefined,
    /** Show a warning message in tests. */
    showWarningMessage: async () : Promise<void> => undefined,
    /** Register a mocked tree data provider. */
    registerTreeDataProvider: () : Disposable => new Disposable(),
    /** Show a text document in tests. */
    showTextDocument: async () : Promise<void> => undefined,
    /** Active text editor stub used by runtime commands. */
    activeTextEditor: undefined as any
};

/** Mocked debug API. */
export const debug =
{
    /** Register a mocked debug adapter descriptor factory. */
    registerDebugAdapterDescriptorFactory: () : Disposable => new Disposable(),
    /** Register a mocked debug-session start listener. */
    onDidStartDebugSession: () : Disposable => new Disposable(),
    /** Register a mocked debug-session terminate listener. */
    onDidTerminateDebugSession: () : Disposable => new Disposable(),
    /** Register a mocked active-debug-session listener. */
    onDidChangeActiveDebugSession: () : Disposable => new Disposable(),
    /** Active debug session stub. */
    activeDebugSession: undefined as any,
    /** Active debug sessions. */
    sessions: [] as any[]
};

/** Mocked inline debug adapter descriptor. */
export class DebugAdapterInlineImplementation
{
    /** Adapter instance supplied to VS Code. */
    public readonly implementation : any;

    /** Store the inline debug adapter instance. */
    public constructor(implementation : any)
    {
        this.implementation = implementation;
    }
}
