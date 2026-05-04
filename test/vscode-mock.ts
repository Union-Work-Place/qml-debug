/** Disposable returned by mocked VS Code event subscriptions. */
class Disposable
{
    /** Release the mocked subscription. */
    public dispose() : void
    {
    }
}

/** Minimal workspace API used by QmlDebugSession tests. */
export const workspace =
{
    /** Return configuration values used by the adapter constructor. */
    getConfiguration: () =>
    {
        return {
            get: <ValueType>(key : string, defaultValue : ValueType) : ValueType => defaultValue,
            update: async () : Promise<void> => undefined
        };
    },

    /** Register a mocked configuration-change listener. */
    onDidChangeConfiguration: () : Disposable => new Disposable()
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
    showInformationMessage: async () : Promise<void> => undefined
};

/** Mocked debug API. */
export const debug =
{
    /** Register a mocked debug adapter descriptor factory. */
    registerDebugAdapterDescriptorFactory: () : Disposable => new Disposable()
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
