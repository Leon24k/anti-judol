import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register({ url: "https://www.youtube.com/watch?v=abc123" });
(globalThis as { __DEV__?: boolean }).__DEV__ = false;
