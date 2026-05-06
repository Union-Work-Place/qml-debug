import path = require("path");
import moduleAlias = require("module-alias");

/** Register module aliases used by the compiled unit-test bundle. */
moduleAlias.addAlias("@qml-debug", path.join(__dirname, "..", "src"));
moduleAlias.addAlias("@qml-debug-root", path.join(__dirname, "..", ".."));
moduleAlias.addAlias("vscode", path.join(__dirname, "vscode-mock"));

