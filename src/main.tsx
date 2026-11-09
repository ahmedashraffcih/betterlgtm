import React from "react";
import ReactDOM from "react-dom/client";
import "react-diff-view/style/index.css";
import "./styles.css";
import App from "./App";
import { suppressDefaultContextMenu } from "./contextMenu";
import { setupPlatform } from "./platform";
import { SettingsWindow } from "./components/SettingsWindow";
import { isSettingsWindow } from "./settingsWindow";

setupPlatform();
suppressDefaultContextMenu();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isSettingsWindow ? <SettingsWindow /> : <App />}
  </React.StrictMode>,
);
