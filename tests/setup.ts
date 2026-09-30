import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register({
  url: "https://www.youtube.com/watch?v=abc123",
  // Tests must never touch the network (fixtures contain real-looking judol URLs).
  settings: {
    disableIframePageLoading: true,
    handleDisabledFileLoadingAsSuccess: true,
    disableJavaScriptFileLoading: true,
    disableCSSFileLoading: true,
    disableComputedStyleRendering: true,
    navigation: { disableChildFrameNavigation: true, disableChildPageNavigation: true, disableMainFrameNavigation: true },
  },
});
(globalThis as { __DEV__?: boolean }).__DEV__ = false;
