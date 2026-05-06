import QtQuick 2.15

Rectangle {
    id: delegateRoot
    width: 96
    height: 42
    radius: 8

    property string labelText: ""
    property bool active: false
    property int indexValue: -1

    objectName: "delegate_" + indexValue
    color: active ? "#334f7d" : "#4b4f58"
    border.width: 1
    border.color: active ? "#86b6ff" : "#9da3ad"

    Text {
        anchors.centerIn: parent
        color: "#ffffff"
        text: labelText + " " + indexValue
    }
}