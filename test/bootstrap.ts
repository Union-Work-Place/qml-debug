import path = require("path");
import moduleAlias = require("module-alias");

moduleAlias.addAlias("@qml-debug", path.join(__dirname, "..", "src"));
moduleAlias.addAlias("@qml-debug-root", path.join(__dirname, "..", ".."));
moduleAlias.addAlias("vscode", path.join(__dirname, "vscode-mock"));

