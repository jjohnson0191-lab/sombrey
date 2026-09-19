import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { initNativeOAuthReturnBridge } from "./features/auth/nativeOAuthReturn.ts";
import "./index.css";

initNativeOAuthReturnBridge();

createRoot(document.getElementById("root")!).render(<App />);
