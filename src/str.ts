export function acceptsFilter(value: string, filter: string) {
    if (filter.startsWith('*') && filter.endsWith('*')) {
        return value.includes(trim(filter, '*'));
    }
    if (filter.startsWith('*')) {
        return value.endsWith(trim(filter, '*'));
    }
    if (filter.endsWith('*')) {
        return value.startsWith(trim(filter, '*'));
    }
    return value === filter;
}

function trim(s, c) {
    if (c === "]") { c = "\\]"; }
    if (c === "\\") { c = "\\\\"; }
    return s.replace(new RegExp(
        "^[" + c + "]+|[" + c + "]+$", "g"
    ), "");
}