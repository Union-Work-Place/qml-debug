cmake_minimum_required(VERSION 3.16)

project(qml_debug_fixture LANGUAGES CXX)

set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(QT NAMES Qt6 Qt5 REQUIRED COMPONENTS Core Gui Qml Quick)
find_package(Qt${QT_VERSION_MAJOR} REQUIRED COMPONENTS Core Gui Qml Quick)

add_executable(qml-debug-fixture
    main.cpp
    qml.qrc
)

target_compile_definitions(qml-debug-fixture PRIVATE QT_QML_DEBUG)

target_link_libraries(qml-debug-fixture PRIVATE
    Qt${QT_VERSION_MAJOR}::Core
    Qt${QT_VERSION_MAJOR}::Gui
    Qt${QT_VERSION_MAJOR}::Qml
    Qt${QT_VERSION_MAJOR}::Quick
)

if(QT_VERSION_MAJOR EQUAL 6)
    qt_import_qml_plugins(qml-debug-fixture)
endif()