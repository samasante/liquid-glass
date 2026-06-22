import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { Playground } from "./views/Playground";
import { Examples } from "./views/Examples";
import { Docs } from "./views/Docs";
import { useView } from "./router";

// Client-side ?view= router (see ./router) — nav swaps the view in place, no
// full-page reload. Default is the playground (the main page).
const App: React.FC = () => {
  const view = useView();
  switch (view) {
    case "examples":
      return <Examples />;
    case "docs":
      return <Docs />;
    case "playground":
    default:
      return <Playground />;
  }
};

createRoot(document.getElementById("root")!).render(<App />);
