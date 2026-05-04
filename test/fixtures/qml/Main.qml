import QtQuick 2.15

Rectangle {
    id: root
    width: 320
    height: 200

    property string title: "Fixture"

    function formatTitle(prefix) {
        return prefix + title
    }

    MouseArea {
        anchors.fill: parent
        onClicked: {
            console.log(root.formatTitle("Clicked "))
        }
    }
}
