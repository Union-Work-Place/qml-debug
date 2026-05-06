import QtQuick 2.15

Rectangle {
    id: panel
    objectName: "fixturePanel"
    width: 320
    height: 150
    radius: 16

    property alias title: titleLabel.text
    property color accent: "#d98b4f"
    property real pulse: 0

    signal triggered()

    color: Qt.rgba(0.16 + pulse * 0.15, 0.18, 0.22, 1.0)
    border.width: 2
    border.color: accent

    Text {
        id: titleLabel
        objectName: "fixturePanelTitle"
        anchors.left: parent.left
        anchors.leftMargin: 18
        anchors.top: parent.top
        anchors.topMargin: 16
        color: "#ffffff"
        text: "Fixture Panel"
    }

    Text {
        objectName: "fixturePanelDetail"
        anchors.left: titleLabel.left
        anchors.top: titleLabel.bottom
        anchors.topMargin: 10
        color: "#d7dbe2"
        text: "Click to toggle runtime state and emit output"
    }

    Rectangle {
        objectName: "fixturePanelAccent"
        anchors.right: parent.right
        anchors.rightMargin: 18
        anchors.verticalCenter: parent.verticalCenter
        width: 28
        height: 28
        radius: 14
        color: accent
    }

    MouseArea {
        anchors.fill: parent
        onClicked: panel.triggered()
    }

    states: [
        State {
            name: "pulsed"
            when: panel.pulse > 0.5

            PropertyChanges {
                target: panel
                scale: 1.02
            }
        }
    ]

    transitions: [
        Transition {
            NumberAnimation {
                properties: "scale"
                duration: 120
            }
        }
    ]
}