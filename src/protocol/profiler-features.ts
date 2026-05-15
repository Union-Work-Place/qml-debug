/** Known QML profiler feature names in the same bit order Qt uses. */
export const QML_PROFILER_FEATURE_NAMES = [
    "JavaScript",
    "Memory Usage",
    "Pixmap Cache",
    "Scene Graph",
    "Animations",
    "Painting",
    "Compiling",
    "Creating",
    "Binding",
    "Handling Signal",
    "Input Events",
    "Debug Messages",
    "Quick 3D"
];

const BIGINT_ZERO = BigInt(0);
const BIGINT_ONE = BigInt(1);

/** Default profiler capture mask: enable every feature Qt Creator exposes in its menu model. */
export const DEFAULT_PROFILER_FEATURE_MASK = (BIGINT_ONE << BigInt(QML_PROFILER_FEATURE_NAMES.length)) - BIGINT_ONE;

/** Return the human-readable feature names enabled in a profiler mask. */
export function profilerFeatureNamesFromMask(mask : bigint) : string[]
{
    const names : string[] = [];

    for (let index = 0; index < QML_PROFILER_FEATURE_NAMES.length; index++)
    {
        if ((mask & (BIGINT_ONE << BigInt(index))) !== BIGINT_ZERO)
            names.push(QML_PROFILER_FEATURE_NAMES[index]);
    }

    return names;
}

/** Parse a profiler mask supplied as a bigint, number, decimal string, or feature-name list. */
export function parseProfilerFeatureMask(value : unknown) : bigint
{
    if (typeof value === "bigint")
        return value;

    if (typeof value === "number" && Number.isFinite(value))
        return BigInt(Math.trunc(value));

    if (typeof value === "string")
    {
        const trimmed = value.trim();
        if (trimmed === "")
            return DEFAULT_PROFILER_FEATURE_MASK;

        return BigInt(trimmed);
    }

    if (Array.isArray(value))
    {
        let mask = BIGINT_ZERO;
        for (const current of value)
        {
            if (typeof current !== "string")
                continue;

            const index = QML_PROFILER_FEATURE_NAMES.findIndex((name) : boolean =>
            {
                return name.toLowerCase() === current.toLowerCase();
            });

            if (index >= 0)
                mask |= (BIGINT_ONE << BigInt(index));
        }

        return mask === BIGINT_ZERO ? DEFAULT_PROFILER_FEATURE_MASK : mask;
    }

    return DEFAULT_PROFILER_FEATURE_MASK;
}