import QtQuick 2.15
import QtQuick.Window 2.15

import "components"
import "helpers.js" as Helpers

Window {
    id: root
    objectName: "fixtureWindow"
    width: 640
    height: 420
    visible: true
    title: "QML Debug Fixture"
    color: "#20242b"

    property string statusText: "Idle"
    property int counter: 0
    property bool toggled: false
    property string decoratedStatus: Helpers.decorateStatus(statusText, counter)

    signal statusTriggered(string label)

    function buildMessage(prefix) {
        return prefix + " " + decoratedStatus
    }

    ListModel {
        id: sampleModel

        ListElement { label: "Alpha"; active: true }
        ListElement { label: "Beta"; active: false }
        ListElement { label: "Gamma"; active: true }
    }

    Timer {
        id: ticker
        interval: 180
        running: true
        repeat: true

        onTriggered: {
            counter += 1

            if (counter === 3)
                statusText = "Warm"

            if (counter === 6)
                pulseAnimation.restart()

            if (counter === 9) {
                statusText = "Animated"
                graphCanvas.requestPaint()
            }

            if (counter === 12) {
                console.info(buildMessage("timer"))
                running = false
            }
        }
    }

    Column {
        anchors.fill: parent
        anchors.margins: 18
        spacing: 12

        Text {
            objectName: "statusLabel"
            color: "#ffffff"
            text: decoratedStatus
        }

        FixturePanel {
            id: inspectorTarget
            objectName: "inspectorTarget"
            title: decoratedStatus
            accent: toggled ? "#65b35b" : "#d98b4f"

            onTriggered: {
                toggled = !toggled
                statusText = toggled ? "Clicked" : "Reset"
                console.log(buildMessage("panel"))
                statusTriggered(statusText)
            }
        }

        Row {
            spacing: 8

            Repeater {
                model: sampleModel

                delegate: FixtureDelegate {
                    labelText: Helpers.describeDelegate(label, active)
                    active: model.active
                    indexValue: index
                }
            }
        }

        Canvas {
            id: graphCanvas
            objectName: "graphCanvas"
            width: 180
            height: 90

            onPaint: {
                var context = getContext("2d")
                context.clearRect(0, 0, width, height)
                context.fillStyle = toggled ? "#65b35b" : "#d98b4f"
                context.fillRect(10, 20, 30 + counter * 8, 20)
                context.fillStyle = "#f0f0f0"
                context.fillRect(10, 55, 120, 8)
            }
        }
    }

    NumberAnimation {
        id: pulseAnimation
        target: inspectorTarget
        property: "pulse"
        from: 0
        to: 1
        duration: 240
    }

    onStatusTriggered: {
        console.warn(buildMessage("statusTriggered " + label))
    }

    Component.onCompleted: {
        console.log(buildMessage("ready"))
        statusTriggered("startup")
    }
}