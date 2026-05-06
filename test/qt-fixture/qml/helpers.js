.pragma library


function decorateStatus(status, counter) {
    return status + " #" + counter;
}

function describeDelegate(label, active) {
    return label + ":" + (active ? "active" : "idle");
}