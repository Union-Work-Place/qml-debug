import * as colors from "colors/safe";


/** Log verbosity levels supported by the extension logger. */
export enum LogLevel
{
    /** Most verbose diagnostic output. */
    Debug,
    /** Function-entry tracing for request flow debugging. */
    Trace,
    /** Rich diagnostic details that are still human-oriented. */
    Detail,
    /** Standard informational output. */
    Info,
    /** Recoverable warning output. */
    Warning,
    /** Non-fatal error output. */
    Error,
    /** Fatal error output that usually precedes termination. */
    CriticalError,
    /** Positive completion output. */
    Success,
}

/** Singleton logger used by the adapter, services, and tests. */
export default class Log
{
    /** Shared singleton instance. */
    private static instance_ = new Log();

    /** Enables or disables all logging output. */
    public enabled = true;
    /** Minimum severity that will be printed. */
    public level = LogLevel.Info;

    /** Derive the caller name from the current stack trace. */
    private className(depth = 4)
    {
        const error = new Error();

        if (error.stack !== null)
            return ((error.stack!).split("at ")[4]).trim().split(" (")[0];
        else
            return "";
    }

    /** Emit one log line when the logger is enabled and the level passes the threshold. */
    private log(level : LogLevel, text : string, sender? : string) : void
    {
        if (!this.enabled || level < this.level)
            return;

        this.logConsole((sender !== undefined ? sender : this.className()), level, text);
    }

    /** Format and print one log line to stdout. */
    public logConsole(fn : string, level : LogLevel, text : string) : void
    {
        let output = colors.white("[" + fn + "] ");
        switch (level)
        {
            case LogLevel.Success:
                output += colors.green("Success");
                break;

            case LogLevel.CriticalError:
                output += colors.red("CRITICAL ERROR");
                break;

            case LogLevel.Error:
                output += colors.red("Error");
                break;

            case LogLevel.Warning:
                output += colors.yellow("Warning");
                break;

            default:
            case LogLevel.Info:
                output += colors.reset("Info");
                break;

            case LogLevel.Detail:
                output += colors.reset("Detail");
                break;

            case LogLevel.Trace:
                output += colors.reset("Trace");
                break;

            case LogLevel.Debug:
                output += colors.reset("Debug");
                break;
        }

        output += ": " + text;

        console.log(output);
    }

    /** Lazily evaluate and emit a debug log message. */
    public static debug(closure : string | (() => string)) : void
    {
        const log = Log.instance();
        if (!log.enabled || log.level > LogLevel.Debug)
            return;

        if (typeof closure === "function")
            log.log(LogLevel.Debug, closure());
        else
            log.log(LogLevel.Debug, closure);
    }

            /** Emit a trace log entry that includes formatted argument values. */
    public static trace(fn : string, args : any) : void
    {
        const log = Log.instance();
        if (!log.enabled || log.level > LogLevel.Trace)
            return;

        let traceText = "";
        for (let i = 0; i < args.length; i++)
        {
            const current = args[i];
            if (typeof current === "undefined")
            {
                traceText += " ";
            }
            else if (typeof current === "number")
            {
                traceText += "" + (current as number);
            }
            else if (typeof current === "bigint")
            {
                traceText += "" + (current as bigint);
            }
            else if (typeof current === "string")
            {
                traceText += "\"" + (current as string) + "\"";
            }
            else if (typeof current === "boolean")
            {
                traceText += (current === false ? "false" : "true");
            }
            else if (typeof current === "function")
            {
                traceText += ("function()");
            }
            else if (typeof current === "object")
            {
                if (current === null)
                    traceText += "null";
                else
                    traceText += "" + current;
            }
            else
            {
                traceText += "UNKNOWN";
            }

            if (i !== args.length - 1)
                traceText += ", ";
        }

        Log.instance().log(LogLevel.Trace, fn + "(" + traceText + ")");
    }

    /** Lazily evaluate and emit a detail log message. */
    public static detail(closure : string | (() => string)) : void
    {
        const log = Log.instance();
        if (!log.enabled || log.level > LogLevel.Detail)
            return;

        if (typeof closure === "function")
            log.log(LogLevel.Detail, closure());
        else
            log.log(LogLevel.Detail, closure);
    }

            /** Emit an informational log message. */
    public static info(text : string) : void
    {
        Log.instance().log(LogLevel.Info, text);
    }

    /** Emit a warning log message. */
    public static warning(text : string) : void
    {
        Log.instance().log(LogLevel.Warning, text);
    }

    /** Emit an error log message. */
    public static error(text : string) : void
    {
        Log.instance().log(LogLevel.Error, text);
    }

    /** Emit a critical error log message. */
    public static critical(text : string) : void
    {
        Log.instance().log(LogLevel.CriticalError, text);
    }

    /** Emit a success log message. */
    public static success(text : string) : void
    {
        Log.instance().log(LogLevel.Success, text);
    }

    /** Return the shared logger instance. */
    public static instance() : Log
    {
        return this.instance_;
    }
}
