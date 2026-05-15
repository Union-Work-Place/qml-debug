import Log from "@qml-debug/common/log";
import Packet from "@qml-debug/transport/packet";
import { profilerFeatureNamesFromMask, DEFAULT_PROFILER_FEATURE_MASK } from "@qml-debug/protocol/profiler-features";
import { QmlDebugSession } from "@qml-debug/adapter/debug-adapter";


/** Compact packet summary retained for quick profiler inspection. */
interface ProfilerPacketSummary
{
    /** Capture timestamp in ISO-8601 form. */
    timestamp : string;
    /** Packet size in bytes. */
    size : number;
    /** Best-effort transport-level classification. */
    kind : string;
    /** Hex preview used in JSON export and UI summaries. */
    hexPreview : string;
}

/** Structured event derived from a captured profiler packet. */
export interface QmlProfilerTimelineEvent extends ProfilerPacketSummary
{
    /** Best-effort Qt Creator-style timeline category. */
    category : "animation" | "binding" | "control" | "javascript" | "memory" | "scene-graph" | "unknown";
    /** Human-readable semantic event label. */
    label : string;
    /** Unit attached to numeric decoded values when known. */
    valueUnit? : "bytes" | "count" | "microseconds" | "milliseconds";
    /** Best-effort decoded primitive payload, when recognized. */
    decodedValue? : boolean | number | string | number[];
}

/** Export payload used by the profiler JSON command. */
export interface QmlProfilerExport
{
    /** Point-in-time profiler summary. */
    summary : QmlProfilerSnapshot;
    /** Frequency table grouped by timeline event kind. */
    eventKinds : { kind : string; count : number }[];
    /** Frequency table grouped by semantic timeline category. */
    eventCategories : { category : string; count : number }[];
    /** Structured event timeline retained in memory. */
    timeline : QmlProfilerTimelineEvent[];
}

/** Snapshot of the current profiler capture state. */
export interface QmlProfilerSnapshot
{
    /** Whether the profiler capture is currently running. */
    recording : boolean;
    /** Requested Qt feature mask in decimal form. */
    requestedFeatureMask : string;
    /** Human-readable feature names derived from the mask. */
    requestedFeatures : string[];
    /** Requested packet flush interval in milliseconds. */
    flushInterval : number;
    /** Number of packets captured so far. */
    packetCount : number;
    /** Number of payload bytes captured so far. */
    receivedBytes : number;
    /** Timestamp of the most recently captured packet. */
    lastPacketTimestamp? : string;
    /** Recent packet summaries for lightweight inspection. */
    recentPackets : ProfilerPacketSummary[];
    /** Structured timeline events retained in memory. */
    timelineEvents : QmlProfilerTimelineEvent[];
}

/** Service wrapper around the CanvasFrameRate profiler transport. */
export default class ServiceQmlProfiler
{
    /** Owning debug session used for transport access. */
    private session? : QmlDebugSession;
    /** Whether capture is currently active. */
    private recording = false;
    /** Requested feature mask used for the next or active capture. */
    private requestedFeatureMask = DEFAULT_PROFILER_FEATURE_MASK;
    /** Requested packet flush interval in milliseconds. */
    private flushInterval = 250;
    /** Number of packets captured during the current snapshot. */
    private packetCount = 0;
    /** Total number of payload bytes captured during the current snapshot. */
    private receivedBytes = 0;
    /** Timestamp of the most recently captured packet. */
    private lastPacketTimestamp? : string;
    /** Rolling window of recent packet summaries. */
    private recentPackets : ProfilerPacketSummary[] = [];
    /** Rolling window of structured timeline events. */
    private timelineEvents : QmlProfilerTimelineEvent[] = [];

    /** Decode a Qt UTF-16 string packet when the payload layout matches. */
    private tryDecodeUtf16String(rawPacket : Buffer) : string | undefined
    {
        if (rawPacket.length < 4 || (rawPacket.length - 4) % 2 !== 0)
            return undefined;

        const length = rawPacket.readUInt32BE(0);
        if (length === 0xFFFFFFFF || length + 4 !== rawPacket.length)
            return undefined;

        return new Packet(rawPacket).readStringUTF16();
    }

    /** Decode a Qt UTF-8 string packet when the payload layout matches. */
    private tryDecodeUtf8String(rawPacket : Buffer) : string | undefined
    {
        if (rawPacket.length < 4)
            return undefined;

        const length = rawPacket.readUInt32BE(0);
        if (length === 0xFFFFFFFF || length + 4 !== rawPacket.length)
            return undefined;

        return new Packet(rawPacket).readStringUTF8();
    }

    /** Add a Qt Creator-style semantic layer on top of the primitive packet kind. */
    private describeTimelineEvent(kind : string, decodedValue : boolean | number | string | number[] | undefined) : Pick<QmlProfilerTimelineEvent, "category" | "label" | "valueUnit">
    {
        if (kind === "boolean")
            return { category: "control", label: decodedValue === true ? "recording-enabled" : "recording-disabled" };

        if (kind === "utf16-string" || kind === "utf8-string")
        {
            const text = String(decodedValue ?? "").toLowerCase();
            if (text.includes("binding"))
                return { category: "binding", label: "binding-event" };
            if (text.includes("animation"))
                return { category: "animation", label: "animation-event" };
            if (text.includes("javascript") || text.includes("script"))
                return { category: "javascript", label: "javascript-event" };
            if (text.includes("memory") || text.includes("alloc"))
                return { category: "memory", label: "memory-event" };

            return { category: "unknown", label: "timeline-string" };
        }

        if (kind === "uint64")
            return { category: "scene-graph", label: "frame-timestamp", valueUnit: "microseconds" };

        if (kind === "int32")
            return { category: "scene-graph", label: "frame-counter", valueUnit: "count" };

        if (kind === "int32-array")
            return { category: "scene-graph", label: "timeline-range" };

        return { category: "unknown", label: "raw-packet" };
    }

    /** Classify and decode a captured profiler packet into a structured event. */
    private decodeTimelineEvent(rawPacket : Buffer, timestamp : string) : QmlProfilerTimelineEvent
    {
        const hexPreview = rawPacket.toString("hex").slice(0, 128);

        if (rawPacket.length === 0)
            return { timestamp: timestamp, size: 0, kind: "empty", category: "unknown", label: "empty-packet", hexPreview: hexPreview };

        if (rawPacket.length === 1 && (rawPacket[0] === 0 || rawPacket[0] === 1))
        {
            const decodedValue = rawPacket[0] === 1;
            return {
                timestamp: timestamp,
                size: 1,
                kind: "boolean",
                ...this.describeTimelineEvent("boolean", decodedValue),
                hexPreview: hexPreview,
                decodedValue: decodedValue
            };
        }

        const utf16String = this.tryDecodeUtf16String(rawPacket);
        if (utf16String !== undefined)
            return {
                timestamp: timestamp,
                size: rawPacket.length,
                kind: "utf16-string",
                ...this.describeTimelineEvent("utf16-string", utf16String),
                hexPreview: hexPreview,
                decodedValue: utf16String
            };

        const utf8String = this.tryDecodeUtf8String(rawPacket);
        if (utf8String !== undefined)
            return {
                timestamp: timestamp,
                size: rawPacket.length,
                kind: "utf8-string",
                ...this.describeTimelineEvent("utf8-string", utf8String),
                hexPreview: hexPreview,
                decodedValue: utf8String
            };

        if (rawPacket.length === 4)
        {
            const decodedValue = new Packet(rawPacket).readInt32BE();
            return {
                timestamp: timestamp,
                size: 4,
                kind: "int32",
                ...this.describeTimelineEvent("int32", decodedValue),
                hexPreview: hexPreview,
                decodedValue: decodedValue
            };
        }

        if (rawPacket.length === 8)
        {
            const decodedValue = Number(new Packet(rawPacket).readUInt64BE());
            return {
                timestamp: timestamp,
                size: 8,
                kind: "uint64",
                ...this.describeTimelineEvent("uint64", decodedValue),
                hexPreview: hexPreview,
                decodedValue: decodedValue
            };
        }

        if (rawPacket.length % 4 === 0 && rawPacket.length <= 64)
        {
            const packet = new Packet(rawPacket);
            const values : number[] = [];
            while (!packet.readEOF())
                values.push(packet.readInt32BE());

            return {
                timestamp: timestamp,
                size: rawPacket.length,
                kind: "int32-array",
                ...this.describeTimelineEvent("int32-array", values),
                hexPreview: hexPreview,
                decodedValue: values
            };
        }

        return {
            timestamp: timestamp,
            size: rawPacket.length,
            kind: "binary",
            ...this.describeTimelineEvent("binary", undefined),
            hexPreview: hexPreview
        };
    }

    /** Record a captured profiler packet in the rolling snapshot buffers. */
    private packetReceived(packet : Packet) : void
    {
        Log.trace("ServiceQmlProfiler.packetReceived", [ packet ]);

        this.packetCount++;
        this.receivedBytes += packet.getSize();
        this.lastPacketTimestamp = new Date().toISOString();
        const timelineEvent = this.decodeTimelineEvent(packet.getData(), this.lastPacketTimestamp);
        this.recentPackets.push(
            {
                timestamp: timelineEvent.timestamp,
                size: timelineEvent.size,
                kind: timelineEvent.kind,
                hexPreview: timelineEvent.hexPreview
            }
        );
        this.timelineEvents.push(timelineEvent);
        if (this.recentPackets.length > 25)
            this.recentPackets.shift();
        if (this.timelineEvents.length > 200)
            this.timelineEvents.shift();
    }

    /** Send the current profiler recording state to the Qt runtime. */
    private async sendRecordingStatus() : Promise<void>
    {
        const packet = new Packet();
        packet.appendBoolean(this.recording);
        packet.appendInt32BE(-1);

        if (this.recording)
        {
            packet.appendUInt64BE(this.requestedFeatureMask);
            packet.appendUInt32BE(this.flushInterval);
            packet.appendBoolean(true);
        }

        const envelope = new Packet();
        envelope.appendStringUTF16("CanvasFrameRate");
        envelope.appendSubPacket(packet);

        await this.session!.packetManager.writePacket(envelope);
    }

    /** Return a snapshot of the current profiler capture state. */
    public getSnapshot() : QmlProfilerSnapshot
    {
        return {
            recording: this.recording,
            requestedFeatureMask: this.requestedFeatureMask.toString(),
            requestedFeatures: profilerFeatureNamesFromMask(this.requestedFeatureMask),
            flushInterval: this.flushInterval,
            packetCount: this.packetCount,
            receivedBytes: this.receivedBytes,
            lastPacketTimestamp: this.lastPacketTimestamp,
            recentPackets: this.recentPackets.map((value) => { return { ...value }; }),
            timelineEvents: this.timelineEvents.map((value) => { return { ...value }; })
        };
    }

    /** Export the in-memory capture buffers as structured JSON data. */
    public exportSnapshot() : QmlProfilerExport
    {
        const eventKinds = new Map<string, number>();
        const eventCategories = new Map<string, number>();
        for (const current of this.timelineEvents)
        {
            eventKinds.set(current.kind, (eventKinds.get(current.kind) ?? 0) + 1);
            eventCategories.set(current.category, (eventCategories.get(current.category) ?? 0) + 1);
        }

        return {
            summary: this.getSnapshot(),
            eventKinds: [ ...eventKinds.entries() ]
                .map((entry) => { return { kind: entry[0], count: entry[1] }; })
                .sort((left, right) : number => { return right.count - left.count || left.kind.localeCompare(right.kind); }),
            eventCategories: [ ...eventCategories.entries() ]
                .map((entry) => { return { category: entry[0], count: entry[1] }; })
                .sort((left, right) : number => { return right.count - left.count || left.category.localeCompare(right.category); }),
            timeline: this.timelineEvents.map((value) => { return { ...value }; })
        };
    }

    /** Start profiler capture with the requested feature mask and flush interval. */
    public async startRecording(featureMask : bigint, flushInterval : number) : Promise<QmlProfilerSnapshot>
    {
        this.requestedFeatureMask = featureMask;
        this.flushInterval = flushInterval;
        this.recording = true;
        await this.sendRecordingStatus();
        return this.getSnapshot();
    }

    /** Stop profiler capture while preserving the buffered snapshot. */
    public async stopRecording() : Promise<QmlProfilerSnapshot>
    {
        this.recording = false;
        await this.sendRecordingStatus();
        return this.getSnapshot();
    }

    /** Clear captured profiler packets and decoded timeline events. */
    public clear() : QmlProfilerSnapshot
    {
        this.packetCount = 0;
        this.receivedBytes = 0;
        this.lastPacketTimestamp = undefined;
        this.recentPackets = [];
        this.timelineEvents = [];
        return this.getSnapshot();
    }

    /** Reset profiler state before the service becomes active. */
    public async initialize() : Promise<void>
    {
        Log.trace("ServiceQmlProfiler.initialize", []);
        this.recording = false;
        this.requestedFeatureMask = DEFAULT_PROFILER_FEATURE_MASK;
        this.flushInterval = 250;
        this.clear();
    }

    /** Stop capture bookkeeping and clear any buffered packets. */
    public async deinitialize() : Promise<void>
    {
        Log.trace("ServiceQmlProfiler.deinitialize", []);
        this.recording = false;
        this.clear();
    }

    /** Register the profiler packet handler on the shared transport. */
    public constructor(session : QmlDebugSession)
    {
        Log.trace("ServiceQmlProfiler.constructor", [ session ]);

        this.session = session;
        this.session.packetManager.registerHandler("CanvasFrameRate",
            (header, packet) : boolean =>
            {
                const servicePacket = packet.readSubPacket();
                this.packetReceived(servicePacket);
                return true;
            }
        );
    }
}